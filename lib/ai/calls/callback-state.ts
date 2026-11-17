import "server-only";

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";

export function callbackState(businessId: string, callerKey: string) {
  const id = createHash("sha256").update(JSON.stringify([businessId, callerKey])).digest("hex");
  return adminDb.collection("missed_call_callback_states").doc(id);
}

const attemptSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), did: z.string(), missedAt: z.number(), attemptedAt: z.number(),
  source: z.enum(["automatic", "manual"]),
  status: z.enum(["REQUESTED", "ANSWERED", "NO_ANSWER", "FAILED", "UNKNOWN", "DEFERRED"]),
});
export type CallbackAttempt = z.infer<typeof attemptSchema>;

export function readCallbackAttempts(value: unknown): CallbackAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(row => {
    const result = attemptSchema.safeParse(row);
    return result.success ? [result.data] : [];
  });
}

export async function saveCallbackAttempt(businessId: string, callerKey: string, attempt: CallbackAttempt) {
  const ref = callbackState(businessId, callerKey);
  await adminDb.runTransaction(async tx => {
    const previous = readCallbackAttempts((await tx.get(ref)).get("history"));
    const existing = previous.find(row => row.id === attempt.id);
    if (existing && ["ANSWERED", "NO_ANSWER", "FAILED"].includes(existing.status) &&
        ["REQUESTED", "UNKNOWN", "DEFERRED"].includes(attempt.status)) return;
    tx.set(ref, { history: [...previous.filter(row => row.id !== attempt.id), {
      ...attempt, attemptedAt: existing && existing.status !== "DEFERRED" ? existing.attemptedAt : attempt.attemptedAt,
    }].sort((a, b) => a.attemptedAt - b.attemptedAt).slice(-30) }, { merge: true });
  });
}

export function callbackResultStatus(value: unknown): CallbackAttempt["status"] {
  return value === "ANSWERED" || value === "NO_ANSWER" || value === "FAILED" ? value : "UNKNOWN";
}

export async function resolveCallback(businessId: string, callerKey: string, through: number,
  resolution: "returned_call_answered" | "sophie_callback_answered" | "marked_complete" = "marked_complete") {
  const ref = callbackState(businessId, callerKey);
  await adminDb.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).get("through") as number | undefined;
    if ((current ?? -1) < through) {
      transaction.set(ref, { through, resolution, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
}
