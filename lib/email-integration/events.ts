import "server-only";

import { EMAIL_EVENTS_COLLECTION } from "@/lib/email-integration/config";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, type Transaction } from "firebase-admin/firestore";

export type EmailEventType =
  | "connected"
  | "reconnected"
  | "disconnected"
  | "needs_reconnect"
  | "queued"
  | "sending"
  | "accepted"
  | "retry_scheduled"
  | "failed"
  | "blocked_auth"
  | "unknown"
  | "held"
  | "retry_requested"
  | "mailbox_action";

export type EmailEventInput = {
  businessId: string;
  eventType: EmailEventType;
  outboxId?: string | null;
  connectionId?: string | null;
  actorId?: string | null;
  /** Safe code/message only — never tokens, bodies or provider payloads. */
  safeErrorDetail?: string | null;
};

function eventDoc(input: EmailEventInput) {
  return {
    businessId: input.businessId,
    eventType: input.eventType,
    outboxId: input.outboxId ?? null,
    connectionId: input.connectionId ?? null,
    actorId: input.actorId ?? null,
    safeErrorDetail: input.safeErrorDetail ?? null,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** Append-only audit trail for mailbox connections and sends. */
export async function recordEmailEvent(
  input: EmailEventInput,
  tx?: Transaction,
): Promise<void> {
  const ref = adminDb.collection(EMAIL_EVENTS_COLLECTION).doc();
  if (tx) {
    tx.create(ref, eventDoc(input));
    return;
  }
  try {
    await ref.create(eventDoc(input));
  } catch (error) {
    console.error("[email] event write failed", input.eventType, (error as Error)?.name);
  }
}
