import "server-only";

import { createHash } from "node:crypto";

import { adminDb } from "@/lib/firebase/admin";
import { isCareplusSecretConfigured } from "@/lib/integrations/careplus/config";
import { CAREPLUS_OUTBOX_COLLECTION } from "@/lib/integrations/careplus/constants";
import { getCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import type {
  CareplusEnqueueInput,
  CareplusJobCompletedPayload,
} from "@/lib/integrations/careplus/types";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

function jobTitle(input: CareplusEnqueueInput): string {
  const custom = input.customRequest?.title?.trim();
  return (
    input.serviceName?.trim() ||
    custom ||
    input.bookingCode?.trim() ||
    `Completed job ${input.id}`
  );
}

export function buildCareplusJobCompletedPayload(
  input: CareplusEnqueueInput,
): CareplusJobCompletedPayload {
  const payload: CareplusJobCompletedPayload = {
    eventId: `bms-${input.id}-completed-v1`,
    eventType: "job.completed",
    businessId: input.businessId,
    jobId: input.id,
    title: jobTitle(input),
    occurredAt: new Date().toISOString(),
  };
  if (input.customerId?.trim()) {
    payload.customerId = input.customerId.trim();
  }
  if (input.assignedTo?.uid?.trim()) {
    payload.staffId = input.assignedTo.uid.trim();
  }
  return payload;
}

export async function enqueueCareplusJobCompleted(
  input: CareplusEnqueueInput,
): Promise<"queued" | "skipped" | "exists"> {
  if (!input.id || !input.businessId) return "skipped";

  const mapping = await getCareplusIntegration(input.businessId);
  if (!mapping || mapping.status !== "active") return "skipped";
  if (!isCareplusSecretConfigured(input.businessId)) return "skipped";

  const payload = buildCareplusJobCompletedPayload(input);
  const rawBody = JSON.stringify(payload);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const ref = adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(payload.eventId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return "exists";
    }
    tx.set(ref, {
      eventId: payload.eventId,
      businessId: input.businessId,
      eventType: "job.completed",
      jobId: input.id,
      payloadHash,
      rawBody,
      status: "pending",
      attempts: 0,
      nextAttemptAt: Timestamp.fromMillis(Date.now()),
      lastStatus: null,
      lastErrorCode: null,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: null,
    });
    return "queued";
  });
}

export async function enqueueCareplusJobCompletedSafe(
  input: CareplusEnqueueInput,
): Promise<void> {
  try {
    await enqueueCareplusJobCompleted(input);
  } catch (error) {
    console.error("[careplus] failed to enqueue job.completed", error);
  }
}
