import "server-only";

import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { EMAIL_MESSAGES_COLLECTION } from "@/lib/email-integration/config";

import { EMAIL_SETTINGS_COLLECTION } from "./settings";

/**
 * What Sophie remembers about her own replies (docs/sophie-email-learning-and-auto-reply.md §8.2,
 * §8.5): per conversation, when she last replied and the Message-IDs of her replies (so "newer email
 * in the thread" doesn't count her own), and whether someone asked for a person; per sender, STOP.
 */

export const REPLY_THREADS_COLLECTION = "ai_email_reply_threads";
export const REPLY_OPTOUTS_COLLECTION = "ai_email_reply_optouts";
const MAX_SENT_IDS = 20;

export const replyThreadId = (businessId: string, connectionId: string, threadId: string) =>
  createHash("sha256").update(`${businessId}\n${connectionId}\n${threadId}`).digest("hex").slice(0, 40);

export type ReplyThread = {
  replyCount: number;
  lastReplyAt: number | null;
  sentMessageIds: string[];
  personRequested: boolean;
};

const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : null);

export async function readReplyThread(db: Firestore, businessId: string, connectionId: string, threadId: string): Promise<ReplyThread | null> {
  const data = (await db.collection(REPLY_THREADS_COLLECTION).doc(replyThreadId(businessId, connectionId, threadId)).get()).data();
  if (!data || data.businessId !== businessId) return null;
  return {
    replyCount: Number(data.replyCount) || 0,
    lastReplyAt: toMillis(data.lastReplyAt),
    sentMessageIds: Array.isArray(data.sentMessageIds) ? data.sentMessageIds.filter((id: unknown): id is string => typeof id === "string") : [],
    personRequested: data.personRequested === true,
  };
}

/** After a reply is queued: one more in the thread, and one more today for the business. */
export async function recordReplySent(
  db: Firestore,
  input: { businessId: string; connectionId: string; threadId: string; messageIdHeader: string | null; localDate: string },
  now: number,
): Promise<void> {
  const threadRef = db.collection(REPLY_THREADS_COLLECTION).doc(replyThreadId(input.businessId, input.connectionId, input.threadId));
  const settingsRef = db.collection(EMAIL_SETTINGS_COLLECTION).doc(input.businessId);
  await db.runTransaction(async (tx) => {
    const [threadSnap, settingsSnap] = [await tx.get(threadRef), await tx.get(settingsRef)];
    const thread = threadSnap.data() ?? {};
    const ids = Array.isArray(thread.sentMessageIds) ? thread.sentMessageIds : [];
    tx.set(threadRef, {
      businessId: input.businessId,
      connectionId: input.connectionId,
      threadId: input.threadId,
      replyCount: (Number(thread.replyCount) || 0) + 1,
      lastReplyAt: Timestamp.fromMillis(now),
      sentMessageIds: [...ids, ...(input.messageIdHeader ? [input.messageIdHeader] : [])].slice(-MAX_SENT_IDS),
      personRequested: thread.personRequested === true,
    }, { merge: true });
    const settings = settingsSnap.data() ?? {};
    const sameDay = settings.replyDay === input.localDate;
    tx.set(settingsRef, { replyDay: input.localDate, replyCount: (sameDay ? Number(settings.replyCount) || 0 : 0) + 1 }, { merge: true });
  });
}

/** Sophie's replies today (a rule's daily cap). */
export async function repliesToday(db: Firestore, businessId: string, localDate: string): Promise<number> {
  const data = (await db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId).get()).data();
  return data?.replyDay === localDate ? Number(data.replyCount) || 0 : 0;
}

export async function isOptedOut(db: Firestore, senderKey: string | null): Promise<boolean> {
  if (!senderKey) return false;
  return (await db.collection(REPLY_OPTOUTS_COLLECTION).doc(senderKey).get()).exists;
}

/**
 * "STOP" or "person" as the first words of a reply to one of Sophie's emails (§8.5). Anything else,
 * or the same words further down, is an ordinary email.
 */
export function replyCommand(text: string): "stop" | "person" | null {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const words = first.toLowerCase().replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (/^(stop|unsubscribe)( (please|thanks|thank you))?$/.test(words)) return "stop";
  if (/^(a |real |speak to a |talk to a )?(person|human)( please)?$/.test(words)) return "person";
  return null;
}

/** Records STOP or "person" for a conversation Sophie replied in. Returns what was recorded. */
export async function applyReplyCommand(
  db: Firestore,
  input: { businessId: string; connectionId: string; threadId: string; senderKey: string; text: string },
  now: number,
): Promise<"stop" | "person" | null> {
  const command = replyCommand(input.text);
  if (!command) return null;
  const thread = await readReplyThread(db, input.businessId, input.connectionId, input.threadId);
  if (!thread || thread.replyCount === 0) return null;
  if (command === "stop") {
    await db.collection(REPLY_OPTOUTS_COLLECTION).doc(input.senderKey).set({
      businessId: input.businessId, source: "stop_reply", createdAt: Timestamp.fromMillis(now),
    }, { merge: true });
  } else {
    await db.collection(REPLY_THREADS_COLLECTION).doc(replyThreadId(input.businessId, input.connectionId, input.threadId))
      .set({ personRequested: true, personRequestedAt: Timestamp.fromMillis(now) }, { merge: true });
  }
  return command;
}

/**
 * Newer email in the conversation than the one being answered: from the customer, or the owner
 * already answered. Sophie's own replies don't count.
 */
export async function threadChangedSince(
  db: Firestore,
  input: { businessId: string; connectionId: string; threadId: string; messageId: string; sentAt: number | null; ownMessageIds: readonly string[] },
): Promise<boolean> {
  const snap = await db.collection(EMAIL_MESSAGES_COLLECTION)
    .where("connectionId", "==", input.connectionId)
    .where("threadId", "==", input.threadId)
    .limit(100)
    .get();
  const own = new Set(input.ownMessageIds);
  return snap.docs.some((doc) => {
    const data = doc.data();
    if (doc.id === input.messageId || data.businessId !== input.businessId) return false;
    if (typeof data.messageIdHeader === "string" && own.has(data.messageIdHeader)) return false;
    const at = toMillis(data.sentAt);
    return at !== null && input.sentAt !== null && at > input.sentAt;
  });
}

/** YYYY-MM-DD in the business time zone. */
export function localDate(now: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}
