import "server-only";

import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";

import { actionLabel, defaultActions, type SuggestionHints } from "./action-list";
import { detailsPrefill } from "./details";
import { emailKindLabel } from "./labels";
import { EMAIL_SETTINGS_COLLECTION } from "./settings";
import { EMAIL_TRIAGE_COLLECTION } from "./collections";
import type { EmailAction, EmailKind, EmailRiskFlag, EmailTriageResult, EmailUrgency } from "./types";

/**
 * Decision cards (docs/sophie-email-learning-and-auto-reply.md §6.1, §6.2): what the owner sees for
 * each email waiting on them, and the push that tells them. A card is built from the triage row;
 * it never holds the email body, and neither does a push.
 */

/** U2 cards: at most one push per half hour. The rest go into the 30-minute digest. */
export const CARD_PUSH_GROUP_MS = 30 * 60_000;
export const EMAILS_SOPHIE_LINK = "/dashboard/emails?tab=sophie";

const FLAG_LABELS: Record<EmailRiskFlag, string> = {
  complaint: "Complaint",
  payment_claim: "Says they've paid",
  bank_change: "Asks to change bank or payment details",
  legal: "Mentions legal action",
  safety: "Safety",
  hardship: "Hardship",
  asks_to_change_rules: "Has instructions for Sophie (ignored)",
  personal: "Personal",
};

const IDENTITY_LABELS: Record<string, string> = {
  verified_thread: "Saved customer, verified, replying to our email",
  verified_sender: "Saved customer, verified",
  contact_match: "The address matches a customer, but isn't verified",
  none: "New sender",
};

export type CardView = {
  triageId: string;
  createdAt: number | null;
  urgency: EmailUrgency;
  sender: { name: string | null; address: string };
  subject: string;
  /** Null for a personal email: the card shows the sender only (§11.3). */
  summary: string | null;
  kind: EmailKind | null;
  kindLabel: string;
  confidence: number | null;
  why: string | null;
  identity: string | null;
  customerName: string | null;
  flags: string[];
  suggestions: { action: EmailAction; label: string }[];
  /** Set when Sophie couldn't sort it: the owner chooses (T20). */
  manual: string | null;
  /** The AI thinks it's personal: ask "Mark this sender as private?" */
  askPrivate: boolean;
  /** Shadow mode: "Here's what I would have done". Nothing is run. */
  shadow: boolean;
  neverReply: boolean;
  /** What the details form starts with when an action saves a customer or adds a request (step 6b). */
  prefill: ReturnType<typeof detailsPrefill> | null;
  /** The suggestions come from one of the owner's rules (step 7): "Your rule says …". */
  fromRule: boolean;
  /** What happened to the safety reply (§10.5), when this is a safety email. */
  safetyReply: string | null;
  /** They answered one of Sophie's replies with STOP or "person" (§8.5). */
  replyCommand: "stop" | "person" | null;
  /** Why Sophie is asking although a rule fits: "I'm not sure enough about this one." */
  ruleNote: string | null;
};

const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : null);

function manualReason(aiError: unknown): string | null {
  if (typeof aiError !== "string" || !aiError) return null;
  return aiError === "mailbox_unavailable"
    ? "I couldn't read this email. Reconnect the mailbox, then choose what it is."
    : "I couldn't sort this one. Please choose what it is.";
}

/** The urgency a waiting email is shown and pushed with. Unsorted mail waits in the queue. */
export function cardUrgency(data: DocumentData): EmailUrgency {
  const urgency = (data.result as EmailTriageResult | null)?.urgency;
  // Someone asking for a person after Sophie's reply hears back today.
  if (data.replyCommand === "person" && urgency !== "now") return "today";
  return urgency === "now" || urgency === "today" || urgency === "info" ? urgency : "routine";
}

/** What else on the triage row shapes Sophie's suggestion. */
export function suggestionHints(data: DocumentData): SuggestionHints {
  const result = (data.result ?? null) as EmailTriageResult | null;
  const document = data.platformDocument as { type?: unknown } | null | undefined;
  return {
    friendlyType: result?.friendlyType ?? null,
    customerIntent: result?.customerIntent ?? null,
    documentType: document?.type === "quote" || document?.type === "invoice" ? document.type : null,
    complaintType: result?.complaintType ?? null,
  };
}

export function cardView(triageId: string, data: DocumentData): CardView {
  const result = (data.result ?? null) as EmailTriageResult | null;
  const kind = result?.kind ?? null;
  const askPrivate = kind === "private";
  const similar = Array.isArray(data.similarExampleIds) ? data.similarExampleIds.length : 0;
  const why = data.examplesAgree === true
    ? `It's like ${similar} earlier emails you handled the same way.`
    : data.precheck === "platform_thread"
      ? "It's a reply in a thread we started."
      : Array.isArray(data.promotionSignals) && data.promotionSignals.length > 0
        ? "The sender's mail system marks it as marketing."
        : null;
  const sender = (data.sender ?? {}) as { name?: unknown; address?: unknown };
  const ruleActions = Array.isArray(data.ruleActions) && data.ruleActions.length > 0 ? (data.ruleActions as EmailAction[]) : null;
  const kindActions = Array.isArray(data.kindActions) && data.kindActions.length > 0 ? (data.kindActions as EmailAction[]) : null;
  return {
    triageId,
    createdAt: toMillis(data.createdAt),
    urgency: cardUrgency(data),
    sender: { name: typeof sender.name === "string" ? sender.name : null, address: typeof sender.address === "string" ? sender.address : "" },
    subject: typeof data.subject === "string" ? data.subject : "",
    summary: askPrivate ? null : result?.summary ?? null,
    kind,
    kindLabel: emailKindLabel(kind),
    confidence: result ? result.confidence : null,
    why,
    identity: typeof data.identity === "string" ? IDENTITY_LABELS[data.identity] ?? null : null,
    customerName: typeof data.customerName === "string" ? data.customerName : null,
    flags: [...new Set([...(result?.flags ?? []), ...(Array.isArray(data.codeFlags) ? data.codeFlags : [])])]
      .map((flag) => FLAG_LABELS[flag as EmailRiskFlag])
      .filter(Boolean),
    suggestions: askPrivate || !kind ? [] : (ruleActions ?? kindActions ?? defaultActions(kind, suggestionHints(data))).map((action) => ({ action, label: actionLabel(action) })),
    manual: result ? null : manualReason(data.aiError),
    askPrivate,
    shadow: data.shadow === true,
    neverReply: data.neverReply === true,
    prefill: askPrivate || typeof sender.address !== "string" || !sender.address ? null : detailsPrefill({
      sender: { name: typeof sender.name === "string" ? sender.name : null, address: sender.address },
      subject: typeof data.subject === "string" ? data.subject : "",
      result,
    }),
    fromRule: !askPrivate && !!kind && ruleActions !== null,
    ruleNote: typeof data.ruleReason === "string" && data.ruleReason ? data.ruleReason : null,
    safetyReply: typeof data.safetyReply?.summary === "string" ? data.safetyReply.summary : null,
    replyCommand: data.replyCommand === "stop" || data.replyCommand === "person" ? data.replyCommand : null,
  };
}

/** Rows waiting for the owner, newest first. Blocked senders are filed, not asked about. */
async function waitingRows(db: Firestore, businessId: string, limit: number) {
  const snap = await db.collection(EMAIL_TRIAGE_COLLECTION)
    .where("businessId", "==", businessId)
    .where("status", "==", "new")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() ?? {} }))
    .filter((row) => row.data.businessId === businessId && row.data.precheck !== "blocked");
}

export async function listCards(db: Firestore, businessId: string, limit = 50): Promise<CardView[]> {
  return (await waitingRows(db, businessId, limit)).map((row) => cardView(row.id, row.data));
}

export type CardPush = { title: string; body: string; data: Record<string, string> };

const oneLine = (value: string, max: number) => {
  const text = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** Sender and subject only. No email body ever goes into a push (§6.2). */
export function cardPush(input: { triageId: string; urgency: EmailUrgency; senderName: string; subject: string }): CardPush {
  return {
    title: input.urgency === "now" ? "Urgent email needs you" : "New email needs your decision",
    body: `${oneLine(input.senderName || "Unknown sender", 40)}: ${oneLine(input.subject || "(no subject)", 80)}`,
    data: { type: "email_card", link: EMAILS_SOPHIE_LINK, triageId: input.triageId },
  };
}

/**
 * Tells the owner about a new card, by urgency (§6.1): U1 at once; U2 at most once per half hour,
 * the rest grouped into the digest; U3 and U4 only in the app and the daily summary.
 * Returns whether a push went out.
 */
export async function notifyNewCard(
  db: Firestore,
  send: (push: CardPush) => Promise<void>,
  input: { businessId: string; triageId: string; urgency: EmailUrgency; senderName: string; subject: string },
  now = Date.now(),
): Promise<boolean> {
  if (input.urgency === "routine" || input.urgency === "info") return false;
  if (input.urgency === "today") {
    const settings = db.collection(EMAIL_SETTINGS_COLLECTION).doc(input.businessId);
    const claimed = await db.runTransaction(async (tx) => {
      const last = toMillis((await tx.get(settings)).data()?.lastCardPushAt);
      if (last !== null && now - last < CARD_PUSH_GROUP_MS) return false;
      tx.set(settings, { lastCardPushAt: Timestamp.fromMillis(now) }, { merge: true });
      return true;
    });
    if (!claimed) return false;
  }
  await send(cardPush(input));
  await db.collection(EMAIL_TRIAGE_COLLECTION).doc(input.triageId).set({ pushedAt: Timestamp.fromMillis(now) }, { merge: true });
  return true;
}

/**
 * For the 30-minute digest when sorting is on: U2 cards since the last digest that didn't get a
 * push of their own. The digest then says "3 emails are waiting for you" instead of listing new mail
 * again, so the owner isn't told twice (§14.1).
 */
export async function groupedCardsSince(
  db: Firestore,
  businessId: string,
  since: number,
): Promise<{ count: number; latest: { from: string; subject: string }[] }> {
  const waiting = (await waitingRows(db, businessId, 50))
    .filter((row) => !row.data.pushedAt && cardUrgency(row.data) === "today" && (toMillis(row.data.createdAt) ?? 0) > since)
    .map((row) => cardView(row.id, row.data));
  return {
    count: waiting.length,
    latest: waiting.slice(0, 3).map((card) => ({ from: card.sender.name || card.sender.address || "Unknown sender", subject: card.subject || "(no subject)" })),
  };
}
