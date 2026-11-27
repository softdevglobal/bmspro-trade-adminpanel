import "server-only";

import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { scanKnowledgeText, redactPersonalData } from "@/lib/ai/learning/redact";
import { EMAIL_MESSAGES_COLLECTION, EMAIL_OUTBOX_COLLECTION } from "@/lib/email-integration/config";
import { splitQuoted } from "@/lib/email-integration/mailbox/compose";
import { messageDocId } from "@/lib/email-integration/mailbox/ids";

import { EMAIL_DECISIONS_COLLECTION, EMAIL_TRIAGE_COLLECTION } from "./collections";
import { emailKindLabel } from "./labels";
import { readGreeting, SIGN_OFF } from "./style-learning";
import type { CustomTemplateRef } from "./templates";

/**
 * Learned reply templates, "R2" (docs/sophie-email-learning-and-auto-reply.md §8.1): when the owner
 * keeps sending much the same reply to one kind of email, Sophie offers "Save this as a reply
 * template?". The owner reads the exact wording, and approves that exact version.
 *
 * What is learnt: the body of the owner's own reply, between the greeting and the sign-off, with the
 * customer's first name turned into the one slot, {firstName}. Anything more specific (a number,
 * a date, a price, a promise, an address, a phone number) means it isn't a template: those must
 * come from records, never from a saved sentence. Sophie's own signature, AI line and STOP line are
 * always added when it is sent.
 */

export const REPLY_TEMPLATES_COLLECTION = "ai_reply_templates";
export const REPLY_SAMPLES_COLLECTION = "ai_reply_samples";
/** Much the same wording: this share of words in common. */
export const SIMILAR_AT_LEAST = 0.75;
/** Replies that are much the same before Sophie offers a template, the newest included. */
export const REPLIES_BEFORE_OFFER = 4;
const MAX_SAMPLES = 12;
export const TEMPLATE_MIN_WORDS = 6;
export const TEMPLATE_MAX_CHARS = 600;

/** Types that are never learnt as templates: they go to the owner, or aren't customer replies. */
const NEVER_TEMPLATE_KINDS = ["private", "system", "unknown", "suspicious", "complaint", "payment_claim", "promotion", "supplier_bill"];

/** Facts that must come from records, never from a saved sentence (§8.2): money, times, promises. */
const NEEDS_RECORDS = /[$€£%]|\d|\b(free|refund|discount|guarantee[ds]?|warrant(?:y|ies)|promise[sd]?|today|tomorrow|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|asap|urgent|within|by (?:the )?end)\b|[$€£%\d]/i;

const words = (text: string) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}{}\s']/gu, " ").split(/\s+/).filter((word) => word.length > 1));

/** Share of words two texts have in common (Jaccard). 1 is identical. */
export function similarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}

/**
 * The reusable middle of one owner reply, or null when it isn't a template: too short or long, or
 * it holds something specific. `recipientFirstName` becomes {firstName}.
 */
export function templateCandidate(body: string, recipientFirstName: string | null): string | null {
  const lines = splitQuoted(body.replace(/\r\n/g, "\n")).written.split("\n").map((line) => line.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  if (lines.length > 0 && readGreeting(lines[0])) lines.shift();
  // The sign-off and everything after it (the owner's name and signature), found in the last lines.
  const start = Math.max(0, lines.length - 6);
  const at = lines.findIndex((line, index) => index >= start && SIGN_OFF.test(line));
  const middle = (at >= 0 ? lines.slice(0, at) : lines).filter((line) => line !== "");
  let text = middle.join(" ").replace(/\s+/g, " ").trim();
  const name = recipientFirstName?.trim();
  if (name && /^[\p{L}][\p{L}'’-]{1,29}$/u.test(name)) text = text.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "{firstName}");
  const redacted = redactPersonalData(text);
  if (redacted !== text || /\[(?:email|phone|number)\]/.test(redacted)) return null;
  if (NEEDS_RECORDS.test(text.replace(/\{firstName\}/g, ""))) return null;
  if (scanKnowledgeText(text).length > 0) return null;
  const count = text.replace(/\{firstName\}/g, "x").split(" ").filter(Boolean).length;
  if (count < TEMPLATE_MIN_WORDS || text.length > TEMPLATE_MAX_CHARS) return null;
  // Only {firstName} may be a slot.
  if ((text.match(/\{[^}]*\}/g) ?? []).some((slot) => slot !== "{firstName}")) return null;
  return text;
}

/** Suggests the owner's approved reply for this kind of email: it replaces the built-in reply, or is added. */
export function withLearnedReply<T extends { kind: string }>(actions: readonly T[], ref: CustomTemplateRef): (T | { kind: "reply"; template: CustomTemplateRef })[] {
  const reply = { kind: "reply" as const, template: ref };
  return actions.some((action) => action.kind === "reply")
    ? actions.map((action) => (action.kind === "reply" ? reply : action))
    : [reply, ...actions];
}

export type OfferedTemplate = { id: string; kind: string; title: string; body: string; version: number; status: TemplateStatus; sampleCount: number };
export type TemplateStatus = "offered" | "approved" | "declined" | "removed";

const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : typeof value === "number" ? value : null);

export const templateDocId = (businessId: string, kind: string, text: string) =>
  createHash("sha256").update(`${businessId}\n${kind}\n${text.toLowerCase()}`).digest("hex").slice(0, 40);

/** `custom_<40 hex>`: how a saved template is named inside a reply action. */
export const customTemplateRef = (id: string): CustomTemplateRef => `custom_${id}`;
export const parseCustomTemplateRef = (ref: unknown): string | null => (typeof ref === "string" && /^custom_[0-9a-f]{40}$/.test(ref) ? ref.slice(7) : null);

/** The `email.sent_by_owner` handler's second job: notice replies that are much the same (§8.1). */
export async function learnReplyTemplate(db: Firestore, businessId: string, outboxId: string, now = Date.now()): Promise<string> {
  const outboxRef = db.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId);
  const item = (await outboxRef.get()).data();
  if (!item || item.businessId !== businessId) return "outbox_missing";
  if (item.origin === "agent" || item.kind !== "message" || item.intent !== "reply" || item.replyLearned === true) return "not_owner_reply";
  const thread = (item.payloadSnapshot as { thread?: { replyToProviderMessageId?: unknown }; bodyText?: unknown } | undefined)?.thread;
  const replyTo = typeof thread?.replyToProviderMessageId === "string" ? thread.replyToProviderMessageId : null;
  const connectionId = typeof item.connectionId === "string" ? item.connectionId : null;
  if (!replyTo || !connectionId) return "no_original";

  // Which kind of email was it? The owner's answer if there is one, otherwise Sophie's guess.
  const messageId = messageDocId(connectionId, replyTo);
  const message = (await db.collection(EMAIL_MESSAGES_COLLECTION).doc(messageId).get()).data();
  if (!message || message.businessId !== businessId) return "no_original";
  const triage = (await db.collection(EMAIL_TRIAGE_COLLECTION).where("messageId", "==", messageId).limit(1).get()).docs[0];
  if (!triage || triage.data()?.businessId !== businessId) return "not_sorted";
  const decision = (await db.collection(EMAIL_DECISIONS_COLLECTION).doc(triage.id).get()).data();
  const kind = String(decision?.confirmedKind ?? (triage.data()?.result as { kind?: unknown } | null)?.kind ?? "");
  if (!kind || NEVER_TEMPLATE_KINDS.includes(kind)) return "not_a_template_kind";

  const first = typeof message.fromName === "string" ? message.fromName.trim().split(/\s+/)[0] : null;
  const candidate = templateCandidate(String((item.payloadSnapshot as { bodyText?: unknown }).bodyText ?? ""), first);
  if (!candidate) return "not_a_template";

  const samplesRef = db.collection(REPLY_SAMPLES_COLLECTION).doc(`${businessId}_${kind.replace(/[^a-z0-9_:]/gi, "_")}`);
  return db.runTransaction(async (tx) => {
    const [samplesSnap, outboxSnap] = [await tx.get(samplesRef), await tx.get(outboxRef)];
    if (outboxSnap.data()?.replyLearned === true) return "already_learned";
    const samples = (Array.isArray(samplesSnap.data()?.samples) ? samplesSnap.data()!.samples : []) as { text: string; at: unknown }[];
    const similar = samples.filter((sample) => similarity(sample.text, candidate) >= SIMILAR_AT_LEAST).length + 1;
    tx.set(samplesRef, { businessId, kind, samples: [...samples, { text: candidate, at: Timestamp.fromMillis(now) }].slice(-MAX_SAMPLES), updatedAt: Timestamp.fromMillis(now) }, { merge: true });
    tx.set(outboxRef, { replyLearned: true }, { merge: true });
    if (similar < REPLIES_BEFORE_OFFER) return "learned";
    const id = templateDocId(businessId, kind, candidate);
    const ref = db.collection(REPLY_TEMPLATES_COLLECTION).doc(id);
    if ((await tx.get(ref)).exists) return "learned";
    tx.set(ref, {
      businessId, kind, title: `Your reply to ${emailKindLabel(kind).toLowerCase()}`, body: candidate, version: 1, status: "offered", sampleCount: similar,
      createdAt: Timestamp.fromMillis(now), statusAt: Timestamp.fromMillis(now),
    });
    return "offered";
  });
}

function mapTemplate(id: string, data: Record<string, unknown>): OfferedTemplate {
  return {
    id, kind: String(data.kind ?? ""), title: String(data.title ?? "Your saved reply"), body: String(data.body ?? ""),
    version: Number(data.version) || 1,
    status: (["offered", "approved", "declined", "removed"] as const).find((status) => status === data.status) ?? "offered",
    sampleCount: Number(data.sampleCount) || 0,
  };
}

export async function listReplyTemplates(db: Firestore, businessId: string): Promise<OfferedTemplate[]> {
  const snap = await db.collection(REPLY_TEMPLATES_COLLECTION).where("businessId", "==", businessId).limit(100).get();
  return snap.docs
    .filter((doc) => doc.data()?.businessId === businessId)
    .map((doc) => mapTemplate(doc.id, doc.data() ?? {}))
    .filter((template) => template.status === "offered" || template.status === "approved")
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** An approved template for this business, or null. The reply action reads it at the moment of sending. */
export async function loadApprovedTemplate(db: Firestore, businessId: string, id: string): Promise<OfferedTemplate | null> {
  const data = (await db.collection(REPLY_TEMPLATES_COLLECTION).doc(id).get()).data();
  if (!data || data.businessId !== businessId) return null;
  const template = mapTemplate(id, data);
  return template.status === "approved" ? template : null;
}

/** The approved template for a kind of email, if there is one (the newest), to suggest on its cards. */
export async function approvedTemplateForKind(db: Firestore, businessId: string, kind: string): Promise<OfferedTemplate | null> {
  const snap = await db.collection(REPLY_TEMPLATES_COLLECTION).where("businessId", "==", businessId).where("kind", "==", kind).limit(10).get();
  const approved = snap.docs
    .filter((doc) => doc.data()?.businessId === businessId && doc.data()?.status === "approved")
    .sort((a, b) => (toMillis(b.data()?.statusAt) ?? 0) - (toMillis(a.data()?.statusAt) ?? 0));
  return approved[0] ? mapTemplate(approved[0].id, approved[0].data() ?? {}) : null;
}

type Change = { ok: true; template: OfferedTemplate } | { ok: false; status: number; error: string };

/** The owner approves the exact wording they were shown, in the app. A template is never approved by Sophie or by voice. */
export async function decideTemplate(
  db: Firestore,
  input: { businessId: string; id: string; version: number; action: "approve" | "decline" | "remove"; actorUid: string },
  now = Date.now(),
): Promise<Change> {
  if (!/^[0-9a-f]{40}$/.test(input.id)) return { ok: false, status: 404, error: "Template not found." };
  const ref = db.collection(REPLY_TEMPLATES_COLLECTION).doc(input.id);
  return db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.businessId !== input.businessId) return { ok: false as const, status: 404, error: "Template not found." };
    const template = mapTemplate(input.id, data);
    if (template.version !== input.version) return { ok: false as const, status: 409, error: "This template changed since you opened it. Look at it again." };
    if (input.action === "remove") {
      if (template.status !== "approved") return { ok: false as const, status: 409, error: "This template isn't in use." };
    } else if (template.status !== "offered") return { ok: false as const, status: 409, error: "This template isn't waiting for approval." };
    const status: TemplateStatus = input.action === "approve" ? "approved" : input.action === "decline" ? "declined" : "removed";
    tx.set(ref, { status, statusAt: Timestamp.fromMillis(now), ...(input.action === "approve" ? { approvedBy: input.actorUid, approvedAt: Timestamp.fromMillis(now) } : {}) }, { merge: true });
    return { ok: true as const, template: { ...template, status } };
  });
}
