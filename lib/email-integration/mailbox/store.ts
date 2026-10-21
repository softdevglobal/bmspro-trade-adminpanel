import "server-only";

import {
  EMAIL_MESSAGES_COLLECTION,
  EMAIL_SYNC_STATE_COLLECTION,
} from "@/lib/email-integration/config";
import { messageDocId } from "@/lib/email-integration/mailbox/ids";
import { parseSender } from "@/lib/email-integration/mailbox/parse";

export { messageDocId };
import type { MailboxMetadata } from "@/lib/email-integration/mailbox/provider";
import type {
  MailboxView,
  MailboxMatch,
  MailboxMessageSummary,
  MailboxSyncStatus,
  PlatformDocumentRef,
} from "@/lib/email-integration/types";
import { adminDb } from "@/lib/firebase/admin";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Upserts one platform-related message. Drafts and spam are flagged out of
 * every view rather than stored as new.
 */
export async function upsertMessage(input: {
  businessId: string;
  connectionId: string;
  message: MailboxMetadata;
  match: MailboxMatch;
}): Promise<"stored" | "removed" | "skipped"> {
  const { businessId, connectionId, message, match } = input;
  const ref = adminDb
    .collection(EMAIL_MESSAGES_COLLECTION)
    .doc(messageDocId(connectionId, message.id));
  const folder = message.folder;

  if (!folder) {
    // Spam and drafts are never stored; a message moved there drops out of views.
    const existing = await ref.get();
    if (!existing.exists) return "skipped";
    await ref.update({ folder: null, updatedAt: FieldValue.serverTimestamp() });
    return "removed";
  }

  const sender = parseSender(message.from);
  await ref.set(
    {
      businessId,
      connectionId,
      providerMessageId: message.id,
      threadId: message.threadId,
      folder,
      fromName: sender.name ? clip(sender.name, 200) : null,
      fromAddress: clip(sender.address, 320),
      to: clip(message.to, 1000),
      cc: clip(message.cc, 1000),
      subject: clip(message.subject, 500),
      snippet: clip(message.snippet, 300),
      sentAt: message.date ? Timestamp.fromMillis(message.date) : null,
      hasAttachments: message.hasAttachments,
      unread: message.unread,
      starred: message.starred,
      // Kept for threading replies (In-Reply-To / References).
      messageIdHeader: clip(message.messageIdHeader, 500),
      references: clip(message.references, 4000),
      matchMethod: match.method,
      customerEmails: match.customerEmails,
      customerName: match.customerName,
      platformDocument: match.document ?? null,
      linked: match.method !== "none",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return "stored";
}

/** Re-labels an already stored message (e.g. its sender became a customer). */
export async function updateMessageMatch(
  connectionId: string,
  providerMessageId: string,
  match: MailboxMatch,
): Promise<void> {
  await adminDb
    .collection(EMAIL_MESSAGES_COLLECTION)
    .doc(messageDocId(connectionId, providerMessageId))
    .set(
      {
        matchMethod: match.method,
        customerEmails: match.customerEmails,
        customerName: match.customerName,
        platformDocument: match.document ?? null,
        linked: match.method !== "none",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/** Updates only folder/unread/starred after an action (keeps why it matched). */
export async function updateMessageLabels(
  connectionId: string,
  message: MailboxMetadata,
): Promise<void> {
  const ref = adminDb
    .collection(EMAIL_MESSAGES_COLLECTION)
    .doc(messageDocId(connectionId, message.id));
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({
    folder: message.folder,
    unread: message.unread,
    starred: message.starred,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function markMessagesDeleted(
  connectionId: string,
  providerMessageIds: string[],
): Promise<void> {
  for (const id of providerMessageIds) {
    const ref = adminDb.collection(EMAIL_MESSAGES_COLLECTION).doc(messageDocId(connectionId, id));
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update({ folder: null, providerDeletedAt: FieldValue.serverTimestamp() });
    }
  }
}

/** Messages already stored, and threads linked to a customer or the platform. */
export async function loadKnownMessages(
  connectionId: string,
): Promise<{ messages: Set<string>; linkedThreads: Set<string> }> {
  const snap = await adminDb
    .collection(EMAIL_MESSAGES_COLLECTION)
    .where("connectionId", "==", connectionId)
    .select("threadId", "providerMessageId", "matchMethod")
    .get();
  const messages = new Set<string>();
  const linkedThreads = new Set<string>();
  for (const doc of snap.docs) {
    const messageId = doc.get("providerMessageId");
    const threadId = doc.get("threadId");
    if (typeof messageId === "string") messages.add(messageId);
    if (typeof threadId === "string" && doc.get("matchMethod") !== "none") {
      linkedThreads.add(threadId);
    }
  }
  return { messages, linkedThreads };
}

/** Deletes every stored message for a mailbox (used before a re-import). */
export async function deleteStoredMessages(connectionId: string): Promise<void> {
  const col = adminDb.collection(EMAIL_MESSAGES_COLLECTION);
  for (;;) {
    const snap = await col.where("connectionId", "==", connectionId).limit(400).get();
    if (snap.empty) break;
    const batch = adminDb.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

function toMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function mapDocumentRef(raw: unknown): PlatformDocumentRef | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  return {
    kind: data.kind === "test" || data.kind === "message" ? data.kind : "document",
    type: data.type === "quote" || data.type === "invoice" ? data.type : null,
    id: typeof data.id === "string" ? data.id : null,
    code: typeof data.code === "string" ? data.code : null,
  };
}

export function mapMessageDoc(id: string, data: DocumentData): MailboxMessageSummary {
  const method = data.matchMethod;
  return {
    id,
    threadId: String(data.threadId ?? ""),
    folder: (["inbox", "sent", "archive", "trash"] as const).includes(data.folder)
      ? data.folder
      : "inbox",
    fromName: typeof data.fromName === "string" ? data.fromName : null,
    fromAddress: String(data.fromAddress ?? ""),
    to: String(data.to ?? ""),
    cc: String(data.cc ?? ""),
    subject: String(data.subject ?? ""),
    snippet: String(data.snippet ?? ""),
    date: toMillis(data.sentAt),
    hasAttachments: data.hasAttachments === true,
    unread: data.unread === true,
    starred: data.starred === true,
    match: {
      method:
        method === "platform_thread" || method === "thread" || method === "customer"
          ? method
          : "none",
      customerEmails: Array.isArray(data.customerEmails)
        ? data.customerEmails.filter((item: unknown): item is string => typeof item === "string")
        : [],
      customerName: typeof data.customerName === "string" ? data.customerName : null,
      document: mapDocumentRef(data.platformDocument),
    },
  };
}

export type StoredMessage = MailboxMessageSummary & {
  providerMessageId: string;
  messageIdHeader: string;
  references: string;
};

function mapStored(id: string, data: DocumentData): StoredMessage {
  return {
    ...mapMessageDoc(id, data),
    providerMessageId: String(data.providerMessageId ?? ""),
    messageIdHeader: String(data.messageIdHeader ?? ""),
    references: String(data.references ?? ""),
  };
}

/** Drops the provider-only fields before a stored message goes to the browser. */
export function toSummary(message: StoredMessage): MailboxMessageSummary {
  const summary: Partial<StoredMessage> = { ...message };
  delete summary.providerMessageId;
  delete summary.messageIdHeader;
  delete summary.references;
  return summary as MailboxMessageSummary;
}

/** One stored message, only when it belongs to the given mailbox. */
export async function getStoredMessage(
  connectionId: string,
  messageId: string,
): Promise<StoredMessage | null> {
  if (!messageId || messageId.includes("/")) return null;
  const snap = await adminDb.collection(EMAIL_MESSAGES_COLLECTION).doc(messageId).get();
  const data = snap.data();
  if (!snap.exists || !data || data.connectionId !== connectionId || !data.folder) return null;
  return mapStored(snap.id, data);
}

export async function listMailboxMessages(input: {
  connectionId: string;
  view: MailboxView;
  /** Only mail linked to a customer or the platform. */
  linkedOnly?: boolean;
  cursor: string | null;
  limit?: number;
}): Promise<{ items: MailboxMessageSummary[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 25));
  const col = adminDb.collection(EMAIL_MESSAGES_COLLECTION);
  let query =
    input.view === "starred"
      ? col.where("connectionId", "==", input.connectionId).where("starred", "==", true)
      : col.where("connectionId", "==", input.connectionId).where("folder", "==", input.view);
  if (input.linkedOnly) query = query.where("linked", "==", true);
  query = query.orderBy("sentAt", "desc").limit(limit + 1);
  if (input.cursor && !input.cursor.includes("/")) {
    const cursorSnap = await col.doc(input.cursor).get();
    if (cursorSnap.exists && cursorSnap.data()?.connectionId === input.connectionId) {
      query = query.startAfter(cursorSnap);
    }
  }
  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  return {
    items: docs.map((doc) => mapMessageDoc(doc.id, doc.data())),
    nextCursor: snap.docs.length > limit ? (docs[docs.length - 1]?.id ?? null) : null,
  };
}

/** Stored messages matching Gmail ids (search results), newest first. */
export async function getStoredMessagesByProviderIds(
  connectionId: string,
  providerMessageIds: string[],
): Promise<MailboxMessageSummary[]> {
  if (providerMessageIds.length === 0) return [];
  const refs = providerMessageIds.map((id) =>
    adminDb.collection(EMAIL_MESSAGES_COLLECTION).doc(messageDocId(connectionId, id)),
  );
  const snaps = await adminDb.getAll(...refs);
  return snaps
    .filter((snap) => snap.exists && snap.data()?.folder && snap.data()?.connectionId === connectionId)
    .map((snap) => mapMessageDoc(snap.id, snap.data() ?? {}))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

/** Stored messages of one thread (all folders), oldest first. */
export async function listThreadMessages(input: {
  connectionId: string;
  threadId: string;
  limit: number;
}): Promise<StoredMessage[]> {
  const snap = await adminDb
    .collection(EMAIL_MESSAGES_COLLECTION)
    .where("connectionId", "==", input.connectionId)
    .where("threadId", "==", input.threadId)
    .orderBy("sentAt", "asc")
    .limit(input.limit)
    .get();
  return snap.docs
    .filter((doc) => doc.data().folder)
    .map((doc) => mapStored(doc.id, doc.data()));
}

export async function getSyncStatus(connectionId: string): Promise<MailboxSyncStatus> {
  const snap = await adminDb.collection(EMAIL_SYNC_STATE_COLLECTION).doc(connectionId).get();
  const data = snap.data() ?? {};
  return {
    lastSuccessAt: toMillis(data.lastSuccessAt),
    lastErrorCode: typeof data.lastErrorCode === "string" ? data.lastErrorCode : null,
    syncing: (toMillis(data.leaseUntil) ?? 0) > Date.now(),
    historyComplete: data.backfill ? data.backfill.done === true : false,
    imported: typeof data.backfill?.imported === "number" ? data.backfill.imported : 0,
    pausedUntil: (toMillis(data.pausedUntil) ?? 0) > Date.now() ? toMillis(data.pausedUntil) : null,
  };
}
