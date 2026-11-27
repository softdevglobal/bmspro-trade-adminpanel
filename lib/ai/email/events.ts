import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { writeAgentEvent } from "@/lib/ai/agent/events";
import { messageDocId } from "@/lib/email-integration/mailbox/ids";
import type { MailboxMetadata } from "@/lib/email-integration/mailbox/provider";

/**
 * New Inbox mail that arrived at or after the cutoff (docs/sophie-email-learning-and-auto-reply.md §4.1).
 * Gmail and Outlook date a message by when it arrived; IMAP by its Date header, which is why the
 * caller only passes mail from the incremental sync and never from the history import.
 */
export function isSortableNewMail(message: Pick<MailboxMetadata, "folder" | "date">, cutoff: number): boolean {
  return message.folder === "inbox" && message.date !== null && message.date >= cutoff;
}

/**
 * Writes `email.received` for each new Inbox message the incremental sync just stored (§14.1).
 * The event id is the stored message's id, so the same message synced twice is one event (T02).
 * Best effort per message: one failed write is logged and the rest still go.
 */
export async function queueReceivedMail(
  db: Firestore,
  input: {
    businessId: string;
    connectionId: string;
    messages: Pick<MailboxMetadata, "id" | "folder" | "date">[];
    /** From emailTriageCutoff(); null when sorting is off. */
    cutoff: number | null;
  },
  now = Date.now(),
): Promise<number> {
  const { cutoff } = input;
  if (cutoff === null) return 0;
  let queued = 0;
  for (const message of input.messages) {
    if (!isSortableNewMail(message, cutoff)) continue;
    try {
      const event = await writeAgentEvent(db, {
        businessId: input.businessId,
        type: "email.received",
        entityId: messageDocId(input.connectionId, message.id),
      }, now);
      if (event.written) queued++;
    } catch (error) {
      console.error("[ai/email] received event failed", (error as Error)?.name);
    }
  }
  return queued;
}
