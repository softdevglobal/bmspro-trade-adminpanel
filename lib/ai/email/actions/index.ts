import "server-only";

import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";

import { recordAgentAction } from "@/lib/ai/agent/audit";
import { agentFlags } from "@/lib/ai/agent/config";
import { checkPolicy, type PolicyReason } from "@/lib/ai/agent/policy";
import { AgentHoldError, type AgentActionStatus, type AutomationLevel } from "@/lib/ai/agent/types";
import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";

import { cardPush, cardUrgency } from "../cards";
import { EMAIL_DECISIONS_COLLECTION, EMAIL_TRIAGE_COLLECTION } from "../collections";
import { DETAIL_ACTIONS } from "../details";
import { demoteRule, ruleStillActive } from "../rules";
import { emailAutoEnabled, emailAutoReplyEnabled, getEmailSettings } from "../settings";
import type { ActionResult, ActionResultStatus, EmailAction, EmailActionKind, EmailDecision } from "../types";
import type { ActionContext, ActionDeps, ActionHandler } from "./context";
import { markRead, moveFolder } from "./mailbox";
import { createInspection, createJobRequest, saveCustomer } from "./customers";
import { addBillItem, addCalendarReminder, ignore, linkThread, notifyOwner, pauseReminders } from "./records";
import { openComplaintCaseAction } from "./complaint";
import { proposeReschedule } from "./reschedule";
import { reply } from "./reply";
import { resendDocument } from "./resend-document";

/**
 * Runs the actions of one decision (docs/sophie-email-learning-and-auto-reply.md step 6), each
 * through the policy check at the moment of acting, with one audit row each, and undoes them.
 */

export type { ActionDeps } from "./context";

export const ACTION_HANDLERS: Record<EmailActionKind, ActionHandler> = {
  save_customer: saveCustomer,
  create_inspection: createInspection,
  create_job_request: createJobRequest,
  link_thread: linkThread,
  add_bill_item: addBillItem,
  pause_reminders: pauseReminders,
  move_folder: moveFolder,
  mark_read: markRead,
  add_calendar_reminder: addCalendarReminder,
  notify_owner: notifyOwner,
  reply,
  resend_document: resendDocument,
  open_complaint_case: openComplaintCaseAction,
  propose_reschedule: proposeReschedule,
  ignore,
};

/** Never done under a rule, whatever it says: the owner decides each complaint (§10.1). */
const NEVER_BY_RULE: ReadonlySet<EmailActionKind> = new Set(["open_complaint_case", "propose_reschedule"]);

/** Actions that email the customer: a rule may do them only where automatic replies are allowed. */
export const SENDS_EMAIL: ReadonlySet<EmailActionKind> = new Set(["reply", "resend_document"]);

/** Whether the owner can undo a finished action of this kind. */
export const canUndo = (kind: EmailActionKind) => typeof ACTION_HANDLERS[kind].undo === "function";

const AUDIT_STATUS: Record<ActionResultStatus, AgentActionStatus> = {
  done: "done",
  skipped: "skipped",
  needs_details: "held",
  manual: "held",
  blocked: "blocked",
  dry_run: "dry_run",
  failed: "failed",
  held: "held",
  undoing: "done",
  undone: "done",
};

const BLOCKED_SUMMARY: Partial<Record<PolicyReason, string>> = {
  PAUSED: "Not done: Sophie's email actions were paused.",
  NO_LONGER_NEEDED: "Not done: the email is no longer in the mailbox.",
};

export function overallStatus(actions: readonly EmailAction[], results: Partial<Record<EmailActionKind, ActionResult>>): EmailDecision["actionsStatus"] {
  const statuses = actions.map((action) => results[action.kind]?.status);
  if (statuses.every((status) => status === "done" || status === "skipped")) return "done";
  if (statuses.some((status) => status === "dry_run")) return "dry_run";
  if (statuses.every((status) => status === "blocked")) return "blocked";
  return "partial";
}

async function load(deps: ActionDeps, triageId: string) {
  const db = deps.db;
  const [decisionSnap, triageSnap] = await Promise.all([
    db.collection(EMAIL_DECISIONS_COLLECTION).doc(triageId).get(),
    db.collection(EMAIL_TRIAGE_COLLECTION).doc(triageId).get(),
  ]);
  const decision = decisionSnap.data();
  const triage = triageSnap.data();
  if (!decision || !triage || decision.businessId !== triage.businessId) return null;
  const messageSnap = await db.collection(EMAIL_MESSAGES_COLLECTION).doc(String(decision.messageId ?? "")).get();
  const message = messageSnap.data();
  return {
    decision,
    triage,
    // A message moved to spam or deleted at the provider is "gone" too.
    message: message && message.businessId === decision.businessId && message.folder ? message : null,
  };
}

function contextFor(deps: ActionDeps, triageId: string, loaded: { decision: DocumentData; triage: DocumentData; message: DocumentData | null }, action: EmailAction, now: number): ActionContext {
  return {
    deps,
    businessId: String(loaded.decision.businessId),
    triageId,
    triage: loaded.triage,
    message: loaded.message,
    authority: loaded.decision.via === "rule" ? "rule" : "owner",
    actorUid: String(loaded.decision.decidedBy ?? ""),
    decision: loaded.decision,
    action,
    now,
  };
}

/** Why a rule decision went back to the owner, in a sentence for the card. */
const RETURN_REASONS: Partial<Record<PolicyReason, string>> = {
  PAUSED: "You paused me before I got to this one, so it's yours.",
  OK: "The rule for emails like this changed before I acted, so I'm asking you.",
  AUTO_NOT_ALLOWED: "I'm not allowed to act alone right now, so I'm asking you.",
  NEEDS_OWNER: "This needs you.",
  NO_LONGER_NEEDED: "The email isn't in the mailbox any more.",
  RULE_OFF: "You turned the rule for emails like this off, so I'm asking you.",
};

/**
 * A rule decision Sophie hasn't started: nothing was done, so the email goes back to the owner as
 * a card, as if no rule had matched. The decision is removed so the owner's answer replaces it.
 */
async function returnToCard(deps: ActionDeps, triageId: string, reason: PolicyReason, now: number): Promise<boolean> {
  const db = deps.db;
  const decisionRef = db.collection(EMAIL_DECISIONS_COLLECTION).doc(triageId);
  const triageRef = db.collection(EMAIL_TRIAGE_COLLECTION).doc(triageId);
  return db.runTransaction(async (tx) => {
    const [decisionSnap, triageSnap] = [await tx.get(decisionRef), await tx.get(triageRef)];
    const decision = decisionSnap.data();
    if (!decision || decision.via !== "rule" || decision.actionsStatus !== "pending") return false;
    const started = Object.values((decision.results ?? {}) as Record<string, ActionResult>).some((result) => result?.status !== "failed");
    if (started || triageSnap.data()?.decisionId !== triageId) return false;
    tx.delete(decisionRef);
    tx.set(triageRef, {
      status: "new",
      decisionId: null,
      spotCheck: false,
      ruleReason: RETURN_REASONS[reason] ?? "I'm asking you about this one.",
      returnedAt: Timestamp.fromMillis(now),
      decidedAt: FieldValue.delete(),
    }, { merge: true });
    return true;
  });
}

/**
 * Runs a decision's actions once. An action that already has a result is never run again, so a
 * run that dies part-way and is retried finishes the rest without repeating anything (T06).
 * A provider error is thrown after saving what was done, so the runner retries the rest later.
 */
export async function runDecisionActions(deps: ActionDeps, triageId: string, now = Date.now()): Promise<string> {
  const loaded = await load(deps, triageId);
  if (!loaded) return "decision_missing";
  const { decision } = loaded;
  if (decision.actionsStatus !== "pending") return "nothing_to_run";
  const businessId = String(decision.businessId);
  const decisionRef = deps.db.collection(EMAIL_DECISIONS_COLLECTION).doc(triageId);
  const settings = await getEmailSettings(deps.db, businessId);
  const env = deps.env ?? process.env;
  const flags = agentFlags(env);
  const actions = (decision.actions ?? []) as EmailAction[];
  // A rule decision is checked again now: the exact rule version must still be approved and
  // automatic, and automatic actions still allowed. Otherwise the owner decides (T08).
  const viaRule = decision.via === "rule";
  let ruleLevel: AutomationLevel = "suggest";
  if (viaRule && typeof decision.ruleId === "string" && typeof decision.ruleVersion === "number") {
    ruleLevel = await ruleStillActive(deps.db, businessId, decision.ruleId, decision.ruleVersion) ? "auto" : "suggest";
  }
  const autoAllowed = emailAutoEnabled(env);
  const autoReplyAllowed = emailAutoReplyEnabled(env);
  const results: Partial<Record<EmailActionKind, ActionResult>> = { ...(decision.results ?? {}) };

  const save = async (kind: EmailActionKind, value: ActionResult, policyReason: string | null, wouldBe: string | null) => {
    results[kind] = value;
    await decisionRef.set({ results: { [kind]: value } }, { merge: true });
    await recordAgentAction(deps.db, {
      businessId,
      eventId: `email.decided:${triageId}`,
      eventType: "email.decided",
      actionKey: kind,
      action: kind,
      status: AUDIT_STATUS[value.status],
      reason: policyReason ?? value.status,
      wouldBe,
    }, now);
  };

  for (const action of actions) {
    const previous = results[action.kind];
    if (previous && previous.status !== "failed" && previous.status !== "held") continue;
    const policy = checkPolicy({
      now,
      flags,
      businessPaused: settings.paused,
      authority: viaRule ? { kind: "rule", level: ruleLevel } : { kind: "owner_approved" },
      autoAllowed: viaRule ? (SENDS_EMAIL.has(action.kind) ? autoReplyAllowed : autoAllowed) : true,
      // Saving customers and adding requests need details the owner confirms: never by a rule.
      neverAuto: DETAIL_ACTIONS.includes(action.kind) || NEVER_BY_RULE.has(action.kind),
      dedupeKeyUsed: false,
      stillNeeded: loaded.message !== null || action.kind === "ignore",
      contact: null,
      text: null,
    });
    if (viaRule && (policy.outcome === "suggest" || policy.outcome === "blocked")) {
      if (await returnToCard(deps, triageId, policy.reason, now)) {
        await recordAgentAction(deps.db, {
          businessId,
          eventId: `email.decided:${triageId}`,
          eventType: "email.decided",
          actionKey: "return_to_owner",
          action: "return_to_owner",
          status: "suggested",
          reason: policy.reason,
        }, now);
        // It never got a push of its own when it was sorted, because Sophie was handling it.
        const urgency = cardUrgency(loaded.triage);
        if (urgency === "now" || urgency === "today") {
          const sender = (loaded.triage.sender ?? {}) as { name?: unknown; address?: unknown };
          await deps.pushOwner(businessId, cardPush({
            triageId,
            urgency,
            senderName: String(sender.name || sender.address || ""),
            subject: String(loaded.triage.subject ?? ""),
          })).catch((error) => console.error("[ai/email] card push failed", (error as Error)?.name));
        }
        return `returned:${policy.reason}`;
      }
      // Part-way through: what's left waits for the owner.
      await save(action.kind, { status: "manual", summary: "Not done: the rule changed part-way, so this one is yours.", undo: null, at: now }, policy.reason, policy.outcome);
      continue;
    }
    if (policy.outcome === "blocked") {
      await save(action.kind, { status: "blocked", summary: BLOCKED_SUMMARY[policy.reason] ?? "Not done.", undo: null, at: now }, policy.reason, null);
      continue;
    }
    if (policy.dryRun) {
      await save(action.kind, { status: "dry_run", summary: "Practice run: nothing was changed.", undo: null, at: now }, policy.reason, policy.outcome);
      continue;
    }
    try {
      const outcome = await ACTION_HANDLERS[action.kind].run(contextFor(deps, triageId, loaded, action, now));
      await save(action.kind, { status: outcome.status, summary: outcome.summary, undo: outcome.undo ?? null, at: now }, null, null);
    } catch (error) {
      if (error instanceof AgentHoldError) {
        // The runner holds the event until then; this action runs again, the rest after it.
        const at = new Date(error.until).toISOString();
        await save(action.kind, { status: "held", summary: "Waiting for your email hours to send it.", undo: null, at: now }, error.message, at);
        throw error;
      }
      await save(action.kind, { status: "failed", summary: "Something went wrong. I'll try again shortly.", undo: null, at: now }, (error as Error)?.name ?? "Error", null);
      throw error;
    }
  }

  const status = overallStatus(actions, results);
  await decisionRef.set({ actionsStatus: status }, { merge: true });
  return `actions:${status}`;
}

export type UndoResult = { ok: true; summary: string } | { ok: false; status: number; error: string };

/**
 * Undoes one finished action. A transaction marks it "undoing" first, so two taps can't undo twice.
 * The decision is then no longer a clean example for Sophie's memory (§7.2).
 */
export async function undoDecisionAction(
  deps: ActionDeps,
  input: { businessId: string; triageId: string; kind: string; actorUid: string },
  now = Date.now(),
): Promise<UndoResult> {
  if (!/^[0-9a-f]{40}$/.test(input.triageId) || !(input.kind in ACTION_HANDLERS)) return { ok: false, status: 404, error: "Action not found." };
  const kind = input.kind as EmailActionKind;
  const handler = ACTION_HANDLERS[kind];
  if (!handler.undo) return { ok: false, status: 409, error: "This one can't be undone." };
  const decisionRef = deps.db.collection(EMAIL_DECISIONS_COLLECTION).doc(input.triageId);

  const claimed = await deps.db.runTransaction(async (tx) => {
    const data = (await tx.get(decisionRef)).data();
    const current = data?.results?.[kind] as ActionResult | undefined;
    if (!data || data.businessId !== input.businessId) return null;
    if (current?.status !== "done") return "not_done" as const;
    tx.set(decisionRef, { results: { [kind]: { ...current, status: "undoing" } } }, { merge: true });
    return current;
  });
  if (claimed === null) return { ok: false, status: 404, error: "Action not found." };
  if (claimed === "not_done") return { ok: false, status: 409, error: "There's nothing to undo." };

  const loaded = await load(deps, input.triageId);
  if (!loaded) return { ok: false, status: 404, error: "Action not found." };
  const action = ((loaded.decision.actions ?? []) as EmailAction[]).find((item) => item.kind === kind);
  if (!action) return { ok: false, status: 404, error: "Action not found." };
  let summary: string;
  try {
    summary = await handler.undo(contextFor(deps, input.triageId, loaded, action, now), claimed.undo ?? {});
  } catch (error) {
    await decisionRef.set({ results: { [kind]: claimed } }, { merge: true });
    return { ok: false, status: 502, error: error instanceof Error && error.message ? error.message : "Couldn't undo that. Try again." };
  }
  const undone: ActionResult = { ...claimed, status: "undone", summary, undoneAt: now, undoneBy: input.actorUid };
  await decisionRef.set({ results: { [kind]: undone } }, { merge: true });
  await recordAgentAction(deps.db, {
    businessId: input.businessId,
    eventId: `email.decided:${input.triageId}`,
    eventType: "email.decided",
    actionKey: `undo:${kind}`,
    action: `undo_${kind}`,
    status: "done",
    reason: "UNDONE",
  }, now);
  // An undone decision no longer counts towards a rule, and a rule's own mistake sends it back to
  // asking (§5.5, T07). Both are best effort: the undo itself is done.
  await decisionRef.set({ undone: true }, { merge: true }).catch(() => undefined);
  if (loaded.decision.via === "rule" && typeof loaded.decision.ruleId === "string") {
    await demoteRule(deps.db, {
      businessId: input.businessId,
      ruleId: loaded.decision.ruleId,
      reason: "You undid one of mine, so I'll ask you about emails like this again.",
      undo: true,
    }, now).catch((error) => console.error("[ai/email] demote failed", (error as Error)?.name));
  }
  if (deps.retireExample) await deps.retireExample(input.businessId, input.triageId).catch(() => undefined);
  return { ok: true, summary };
}
