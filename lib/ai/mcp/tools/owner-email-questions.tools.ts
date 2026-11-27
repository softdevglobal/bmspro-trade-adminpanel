import "server-only";

import { z } from "zod";

import { writeAgentEvent } from "@/lib/ai/agent/events";
import { defaultActions } from "@/lib/ai/email/action-list";
import { cardView, listCards } from "@/lib/ai/email/cards";
import { EMAIL_TRIAGE_COLLECTION } from "@/lib/ai/email/collections";
import { complaintTypeLabel, listOpenCases, replyByLabel } from "@/lib/ai/email/complaints/cases";
import { saveReturnVisitPolicy } from "@/lib/ai/email/complaints/policies";
import { describeReturnVisitPolicy, parseReturnVisitPolicy } from "@/lib/ai/email/complaints/return-visit-policy";
import { decideCard, type CardChoice } from "@/lib/ai/email/decisions";
import { needsDetails } from "@/lib/ai/email/details";
import { kindChoices } from "@/lib/ai/email/kinds";
import { createEmailMemory } from "@/lib/ai/email/memory";
import { listRules, offerRuleAfterDecision, ruleView, setRuleLevel } from "@/lib/ai/email/rules";
import { emailComplaintsEnabled, emailTriageAvailable, updateEmailSettings } from "@/lib/ai/email/settings";
import { EMAIL_SUMMARIES_COLLECTION } from "@/lib/ai/email/summary";
import { EMAIL_AUTOMATION_CONTENT_NOTE } from "@/lib/ai/owner-call/owner-email-questions";
import type { VoiceResult } from "@/lib/ai/owner-call/owner-team";
import type { Firestore } from "firebase-admin/firestore";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";

import type { ActionOwner } from "./owner-actions.tools";

/**
 * What the owner's voice tools for Sophie's email do (lib/ai/owner-call/owner-email-questions.ts).
 * They call the same Sophie functions the app's routes call, as the owner, so every check and audit
 * row is the same as a tap in the app. Results are short, spoken-friendly, and hold no email bodies,
 * addresses or phone numbers.
 */

/** The real database, loaded only when no other is given (tests give a fake). */
const realDb = async (): Promise<Firestore> => (await import("@/lib/firebase/admin")).adminDb;

const UNAVAILABLE: VoiceResult = { status: "UNAVAILABLE", message: "Sophie's email assistant isn't available right now. Use the Emails page." };
const NOTE = { note: EMAIL_AUTOMATION_CONTENT_NOTE };
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const rejected = (message: string): { ok: false; result: VoiceResult } => ({ ok: false, result: { status: "REJECTED", message } });

function waited(since: number | null, now = Date.now()): string {
  if (since === null) return "a while";
  const minutes = Math.max(1, Math.round((now - since) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.round(hours / 24)} days`;
}

const paging = z.object({ limit: z.number().int().min(1).max(10).optional(), offset: z.number().int().min(0).max(1000).optional() });

// ---- Reads -----------------------------------------------------------------------------------

async function emailQuestions(owner: ActionOwner, args: unknown, db: Firestore): Promise<VoiceResult> {
  const parsed = paging.safeParse(args ?? {});
  if (!parsed.success) return { status: "REJECTED", message: "Use a limit of 1 to 5." };
  const limit = Math.min(parsed.data.limit ?? 3, 5);
  const offset = parsed.data.offset ?? 0;
  const cards = await listCards(db, owner.businessId, 50);
  const page = cards.slice(offset, offset + limit);
  return {
    status: "OK",
    total: cards.length,
    nextOffset: offset + limit < cards.length ? offset + limit : null,
    questions: page.map((card) => ({
      id: card.triageId,
      from: card.sender.name || "an unknown sender",
      subject: clip(card.subject || "(no subject)", 80),
      looksLike: card.kindLabel,
      surePercent: card.confidence === null ? null : Math.round(card.confidence * 100),
      urgency: card.urgency,
      sophieSuggests: card.shadow ? ["Nothing yet: practice mode, your answer teaches her"] : card.suggestions.map((item) => item.label),
      needsScreen: !card.shadow && needsDetails(card.suggestions.map((item) => item.action.kind)),
      waitingFor: waited(card.createdAt),
      ...(card.fromRule ? { fromYourRule: true, whyAsking: card.ruleNote } : {}),
    })),
    ...NOTE,
    message: cards.length === 0
      ? "Nothing is waiting for the owner."
      : "Read the first one out and ask what to do. Use answer_email_question with its id. Ones marked needsScreen must be answered on the Emails page.",
  };
}

const localDay = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

async function emailSummary(owner: ActionOwner, args: unknown, db: Firestore): Promise<VoiceResult> {
  const timeZone = owner.timezone || PLATFORM_TIME_ZONE;
  const wanted = typeof (args as { date?: unknown } | null)?.date === "string" ? String((args as { date: string }).date).trim().toLowerCase() : "";
  let data: Record<string, unknown> | undefined;
  if (!wanted) {
    const snap = await db.collection(EMAIL_SUMMARIES_COLLECTION).where("businessId", "==", owner.businessId).orderBy("createdAt", "desc").limit(1).get();
    data = snap.docs[0]?.data();
  } else {
    const day = wanted === "today" ? localDay(Date.now(), timeZone)
      : wanted === "yesterday" ? localDay(Date.now() - 86_400_000, timeZone)
        : /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : null;
    if (!day) return { status: "REJECTED", message: "Use today, yesterday or a date like 2026-11-26." };
    data = (await db.collection(EMAIL_SUMMARIES_COLLECTION).doc(`${owner.businessId}_${day}`).get()).data();
  }
  const summary = data && data.businessId === owner.businessId ? (data.summary as Record<string, unknown> | undefined) : undefined;
  if (!summary) return { status: "NO_SUMMARY", message: "There isn't a summary for that day yet. Sophie writes one each evening." };
  const list = (value: unknown, pick: (item: Record<string, unknown>) => string, max = 5) =>
    (Array.isArray(value) ? value : []).slice(0, max).map((item) => pick(item as Record<string, unknown>));
  return {
    status: "OK",
    day: summary.dateLabel,
    handled: list(summary.handled, (item) => String(item.label)),
    waitingForYou: Number(summary.waitingTotal) || 0,
    waiting: list(summary.waiting, (item) => String(item.line)),
    newKindsToTeachHer: list(summary.newKinds, (item) => String(item.label)),
    kindWords: list(summary.kindWords, (item) => String(item)),
    openComplaints: list(summary.openComplaints, (item) => String(item.line)),
    decisionsToCheck: Array.isArray(summary.spotChecks) ? summary.spotChecks.length : 0,
    keptPrivate: Number(summary.privateCount) || 0,
    ...NOTE,
    message: "Read the highlights out loud, short: what was handled, what is waiting, and any complaints.",
  };
}

async function emailRules(owner: ActionOwner, db: Firestore): Promise<VoiceResult> {
  const rules = (await listRules(db, owner.businessId)).map(ruleView);
  const words = { auto: "Sophie does it herself", suggest: "she asks first", off: "off" } as const;
  return {
    status: "OK",
    rules: rules.slice(0, 15).map((rule) => ({
      id: rule.id,
      rule: rule.sentence,
      now: rule.status === "offered" ? "waiting for the owner to approve it in the app" : words[rule.level],
      version: rule.version,
      timesRun: rule.autoCount,
      timesUndone: rule.undoCount,
      reviewDue: rule.reviewAt ? new Date(rule.reviewAt).toISOString().slice(0, 10) : null,
    })),
    message: rules.length === 0 ? "Sophie hasn't learnt any rules yet." : "A rule waiting for approval is approved in the app, never by voice.",
  };
}

async function openComplaints(owner: ActionOwner, args: unknown, db: Firestore): Promise<VoiceResult> {
  if (!emailComplaintsEnabled()) return { status: "OK", cases: [], message: "Complaint handling isn't switched on." };
  const parsed = paging.safeParse(args ?? {});
  if (!parsed.success) return { status: "REJECTED", message: "Use a limit of 1 to 10." };
  const limit = parsed.data.limit ?? 5;
  const offset = parsed.data.offset ?? 0;
  const timeZone = owner.timezone || PLATFORM_TIME_ZONE;
  const cases = await listOpenCases(db, owner.businessId, 50);
  const stage: Record<string, string> = {
    open: "just opened", waiting_staff: "waiting for the technician", waiting_owner: "waiting for the owner", escalated: "overdue, waiting for the owner",
    waiting_customer: "waiting for the customer", revisit_booked: "return visit booked", follow_up: "checking the fix",
  };
  return {
    status: "OK",
    total: cases.length,
    nextOffset: offset + limit < cases.length ? offset + limit : null,
    cases: cases.slice(offset, offset + limit).map((item) => ({
      customer: item.customerName ?? "an unverified sender",
      job: item.facts.find((fact) => fact.label === "Job")?.value ?? "not linked to a job",
      kind: complaintTypeLabel(item.type),
      stage: stage[item.status] ?? "open",
      replyBy: item.replyBy ? replyByLabel(item.replyBy, timeZone) : null,
    })),
    ...NOTE,
    message: cases.length === 0 ? "No complaints are open." : "Read them out briefly. The owner handles each one on the Emails page.",
  };
}

// ---- Changes made straight away: they only make Sophie do less -----------------------------

const ruleLevelArgs = z.object({ ruleId: z.string().regex(/^[0-9a-f]{40}$/), level: z.enum(["suggest", "off", "auto"]) });

async function ruleLevel(owner: ActionOwner, args: unknown, db: Firestore): Promise<VoiceResult> {
  const parsed = ruleLevelArgs.safeParse(args);
  if (!parsed.success) return { status: "REJECTED", message: "Use a ruleId from get_email_rules, and a level of suggest or off." };
  if (parsed.data.level === "auto") {
    return { status: "REFUSED", message: "Making a rule automatic is only done in the app, by approving the exact rule. Ask the owner to open Emails → Sophie." };
  }
  const result = await setRuleLevel(db, { businessId: owner.businessId, ruleId: parsed.data.ruleId, level: parsed.data.level });
  if (!result.ok) return { status: "REJECTED", message: result.error };
  return {
    status: "DONE",
    message: parsed.data.level === "off" ? "Done: that rule is off." : "Done: Sophie will ask first about emails like that. Tell the owner.",
  };
}

async function pause(owner: ActionOwner, db: Firestore): Promise<VoiceResult> {
  await updateEmailSettings(db, owner.businessId, { paused: true }, owner.uid);
  return { status: "DONE", message: "Done: Sophie's email actions are paused. She keeps sorting so nothing is missed. The owner resumes in Settings or on the Emails page." };
}

const policyArgs = z.object({
  window: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("saturdays"), count: z.number().int().min(1).max(6).optional(), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }),
    z.object({ kind: z.literal("within_days"), days: z.number().int().min(1).max(14) }),
    z.object({ kind: z.literal("first_free"), withinDays: z.number().int().min(1).max(30).optional() }),
  ]),
  complaintTypes: z.array(z.enum(["work_unfinished", "repeat_fault", "quality", "missed_visit", "late_arrival", "no_update"])).max(6).optional(),
  noCharge: z.boolean().optional(),
  maxPerWeek: z.number().int().min(1).max(20).optional(),
});

async function returnVisitDraft(owner: ActionOwner, args: unknown, db: Firestore): Promise<VoiceResult> {
  const parsed = policyArgs.safeParse(args);
  if (!parsed.success) {
    return { status: "NEEDS_INFO", message: "Ask the owner: Saturdays (how many, and between which hours), within how many business days, or the first free time? And which complaints, and is it at no charge?" };
  }
  const { window } = parsed.data;
  if (window.kind === "saturdays" && (!window.startTime || !window.endTime)) {
    return { status: "NEEDS_INFO", message: "Between which hours on Saturday? For example 8 am to 12 pm." };
  }
  const policy = {
    window: window.kind === "saturdays" ? { kind: "saturdays", count: window.count ?? 2, startTime: window.startTime, endTime: window.endTime }
      : window.kind === "within_days" ? { kind: "business_days", days: window.days }
        : { kind: "first_free", withinDays: window.withinDays ?? 14 },
    appliesTo: parsed.data.complaintTypes,
    noCharge: parsed.data.noCharge === true,
    weeklyLimit: parsed.data.maxPerWeek ?? 5,
  };
  const checked = parseReturnVisitPolicy(policy);
  if (!checked.ok) return { status: "REJECTED", message: checked.error };
  const saved = await saveReturnVisitPolicy(db, { businessId: owner.businessId, policy, actorUid: owner.uid });
  if (!saved.ok) return { status: "REJECTED", message: saved.error };
  return {
    status: "DRAFT_SAVED",
    version: saved.value.version,
    rule: describeReturnVisitPolicy(checked.policy),
    message: `Read this back: ${describeReturnVisitPolicy(checked.policy)} It is saved as a draft and does nothing yet. Tell the owner they approve this exact rule in Settings → Sophie → Return visits and compensation. You cannot approve it.`,
  };
}

// ---- Answering a card, with the owner's yes -------------------------------------------------

const answerArgs = z.object({ triageId: z.string().regex(/^[0-9a-f]{40}$/), choice: z.enum(["do_this", "ignore", "not_this_type"]), correctKind: z.string().max(80).optional() });
export type PreparedEmailAnswer = { triageId: string; choice: "do_this" | "ignore" | "not_this_type"; kind?: string };

export async function prepareEmailAnswer(owner: ActionOwner, args: unknown, given?: Firestore): Promise<{ ok: true; payload: PreparedEmailAnswer; summary: string } | { ok: false; result: VoiceResult }> {
  const db = given ?? await realDb();
  const parsed = answerArgs.safeParse(args);
  if (!parsed.success) return rejected("Use an id from get_email_questions and a choice: do_this, ignore or not_this_type.");
  const { triageId, choice, correctKind } = parsed.data;
  const row = (await db.collection(EMAIL_TRIAGE_COLLECTION).doc(triageId).get()).data();
  if (!row || row.businessId !== owner.businessId || row.status !== "new" || row.decisionId || row.precheck === "private" || row.precheck === "blocked") {
    return rejected("That email isn't waiting for an answer any more. Ask for the list again.");
  }
  const card = cardView(triageId, row);
  const who = card.sender.name || "that sender";
  if (card.askPrivate) return rejected("Sophie thinks this one is private. Answer it on the Emails page: it asks whether to keep the sender private.");

  if (choice === "ignore") {
    return { ok: true, payload: { triageId, choice }, summary: `Ignore the email from ${who}. Sophie learns that you ignore emails like this.` };
  }
  if (choice === "do_this") {
    if (!card.kind || card.suggestions.length === 0) return rejected("Sophie has no suggestion for this one. Answer it on the Emails page, or say what type it is.");
    if (!card.shadow && needsDetails(card.suggestions.map((item) => item.action.kind))) {
      return rejected("This one saves a customer or adds a request, which needs the customer's details checked on screen. Answer it on the Emails page.");
    }
    const what = card.shadow ? "Nothing is done yet in practice mode; her guess is recorded as right." : `Then: ${card.suggestions.map((item) => item.label).join("; ")}.`;
    return { ok: true, payload: { triageId, choice }, summary: `Mark the email from ${who} as "${card.kindLabel}". ${what}` };
  }
  const { kinds, defaults } = await kindChoices(db, owner.businessId);
  const kind = correctKind?.trim();
  if (!kind || !kinds.has(kind) || kind === "private" || kind === "system") {
    return { ok: false, result: { status: "NEEDS_INFO", message: `Which type is it? Choose one of: ${[...kinds].filter((item) => item !== "private" && item !== "system").slice(0, 25).join(", ")}.` } };
  }
  const actions = defaults.get(kind) ?? defaultActions(kind as never);
  if (!card.shadow && needsDetails(actions.map((action) => action.kind))) {
    return rejected("That type saves a customer or adds a request, which needs the customer's details checked on screen. Answer it on the Emails page.");
  }
  return { ok: true, payload: { triageId, choice, kind }, summary: `Mark the email from ${who} as "${kind.replace(/^custom:/, "").replace(/_/g, " ")}" instead of "${card.kindLabel}", and do what Sophie suggests for that type.` };
}

export async function confirmEmailAnswer(owner: ActionOwner, payload: PreparedEmailAnswer, given?: Firestore): Promise<VoiceResult> {
  const db = given ?? await realDb();
  const { kinds, defaults } = await kindChoices(db, owner.businessId);
  const choice: CardChoice = payload.choice === "do_this" ? { choice: "confirm" }
    : payload.choice === "ignore" ? { choice: "ignore" }
      : { choice: "change_kind", kind: payload.kind };
  const result = await decideCard(db, {
    businessId: owner.businessId, triageId: payload.triageId, actorUid: owner.uid, via: "voice", choice, kinds, defaults,
    memory: createEmailMemory(db), timeZone: owner.timezone,
  });
  if (!result.ok) {
    return { status: result.code === "rule_changed" ? "STALE" : "REJECTED", message: `${result.error} Nothing was done. Ask for the list again.` };
  }
  // The runner carries the actions out, with retries, within a few minutes.
  if (result.decision.actionsStatus === "pending") {
    await writeAgentEvent(db, { businessId: owner.businessId, type: "email.decided", entityId: payload.triageId });
  }
  const offer = await offerRuleAfterDecision(db, result.decision).catch(() => null);
  return {
    status: "DONE",
    message: `Done. ${result.decision.actionsStatus === "pending" ? "Sophie is doing it now." : "Sophie has learnt from it."}${offer ? " She also has a question about doing emails like this herself: the owner answers it in the app." : ""} Tell the owner.`,
  };
}

// ---- Dispatch --------------------------------------------------------------------------------

/** The read and immediate tools. The prepare tool goes through the pending-change store instead. */
export async function runOwnerEmailAutomation(owner: ActionOwner, name: string, args: unknown, given?: Firestore): Promise<VoiceResult> {
  if (!emailTriageAvailable()) return UNAVAILABLE;
  try {
    const db = given ?? await realDb();
    switch (name) {
      case "get_email_questions": return await emailQuestions(owner, args, db);
      case "get_email_summary": return await emailSummary(owner, args, db);
      case "get_email_rules": return await emailRules(owner, db);
      case "get_open_complaints": return await openComplaints(owner, args, db);
      case "set_email_rule_level": return await ruleLevel(owner, args, db);
      case "pause_email_automation": return await pause(owner, db);
      case "prepare_return_visit_policy": return await returnVisitDraft(owner, args, db);
      default: return { status: "UNAVAILABLE", message: "That tool isn't available." };
    }
  } catch {
    // Never leak details (§14.8).
    return { status: "UNAVAILABLE", message: UNAVAILABLE.message };
  }
}

