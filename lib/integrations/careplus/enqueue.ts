import "server-only";

import { createHash } from "node:crypto";

import { adminDb } from "@/lib/firebase/admin";
import { isCareplusSecretConfigured } from "@/lib/integrations/careplus/config";
import { CAREPLUS_OUTBOX_COLLECTION } from "@/lib/integrations/careplus/constants";
import {
  activeCustomerCareplusId,
  activeStaffCareplusId,
  getCareplusIntegration,
} from "@/lib/integrations/careplus/mapping";
import type {
  CareplusEnqueueInput,
  CareplusEventType,
  CareplusJobCompletedPayload,
  CareplusRecordPayload,
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

function clockFromInstant(value: number | null | undefined): {
  date: string;
  time: string;
} | null {
  if (!value || !Number.isFinite(value)) return null;
  const iso = new Date(value).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function visitDuration(input: CareplusEnqueueInput): number {
  if (
    typeof input.estimatedDurationMinutes === "number" &&
    input.estimatedDurationMinutes >= 5
  ) {
    return Math.min(1440, Math.round(input.estimatedDurationMinutes));
  }
  if (input.visitStartedAt && input.visitEndedAt) {
    const minutes = Math.round((input.visitEndedAt - input.visitStartedAt) / 60000);
    if (minutes >= 5) return Math.min(1440, minutes);
  }
  return 60;
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

export async function buildCareplusActivityCompletedPayload(
  input: CareplusEnqueueInput,
): Promise<CareplusRecordPayload> {
  const customerId =
    (await activeCustomerCareplusId(input.businessId, input.customerId)) ||
    input.customerId?.trim() ||
    "";
  const staffId =
    (await activeStaffCareplusId(input.businessId, input.assignedTo?.uid)) ||
    input.assignedTo?.uid?.trim() ||
    "";
  const fromVisit =
    clockFromInstant(input.visitEndedAt) || clockFromInstant(input.visitStartedAt);
  const date = input.scheduledSlot?.date || fromVisit?.date || new Date().toISOString().slice(0, 10);
  const time =
    input.scheduledStartTime?.slice(0, 5) ||
    input.scheduledSlot?.startTime?.slice(0, 5) ||
    fromVisit?.time ||
    "09:00";
  const notes =
    input.jobInstructionsDescription?.trim() ||
    input.ownerNote?.trim() ||
    input.customRequest?.description?.trim() ||
    `BMS job ${input.bookingCode || input.id} completed.`;
  return {
    eventId: `bms-${input.id}-activity-completed-v1`,
    eventType: "activity.completed",
    businessId: input.businessId,
    occurredAt: new Date().toISOString(),
    source: {
      recordId: input.id,
      jobId: input.id,
      customerId,
      staffId,
      revision: 1,
    },
    record: {
      title: jobTitle(input),
      customerId,
      staffId,
      serviceName: input.serviceName?.trim() || "",
      date,
      time,
      duration: visitDuration(input),
      notes,
    },
  };
}

export async function enqueueCareplusRecord(
  payload: CareplusRecordPayload | CareplusJobCompletedPayload,
  jobId = "",
): Promise<"queued" | "skipped" | "exists"> {
  if (!payload.eventId || !payload.businessId) return "skipped";

  const mapping = await getCareplusIntegration(payload.businessId);
  if (!mapping || mapping.status !== "active") return "skipped";
  if (!isCareplusSecretConfigured(payload.businessId)) return "skipped";

  const rawBody = JSON.stringify(payload);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const ref = adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(payload.eventId);
  const sourceJobId =
    jobId ||
    ("jobId" in payload ? payload.jobId : payload.source.jobId) ||
    payload.eventId;

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return "exists";
    }
    tx.set(ref, {
      eventId: payload.eventId,
      businessId: payload.businessId,
      eventType: payload.eventType,
      jobId: sourceJobId,
      payloadHash,
      rawBody,
      status: "pending",
      attempts: 0,
      nextAttemptAt: Timestamp.fromMillis(Date.now()),
      lastStatus: null,
      lastErrorCode: null,
      processingStatus: null,
      careplusRecordId: null,
      careplusResource: null,
      corrections: [],
      createdAt: FieldValue.serverTimestamp(),
      sentAt: null,
    });
    return "queued";
  });
}

export async function enqueueCareplusJobCompleted(
  input: CareplusEnqueueInput,
): Promise<"queued" | "skipped" | "exists"> {
  if (!input.id || !input.businessId) return "skipped";
  return enqueueCareplusRecord(
    await buildCareplusActivityCompletedPayload(input),
    input.id,
  );
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

export async function enqueueCareplusDirectorySafe(input: {
  businessId: string;
  eventType: Extract<CareplusEventType, "directory.staff" | "directory.participant">;
  recordId: string;
  record: Record<string, unknown>;
}): Promise<void> {
  try {
    await enqueueCareplusRecord({
      eventId: `bms-${input.recordId}-${input.eventType}-v1`,
      eventType: input.eventType,
      businessId: input.businessId,
      occurredAt: new Date().toISOString(),
      source: { recordId: input.recordId, revision: 1 },
      record: input.record,
    });
  } catch (error) {
    console.error("[careplus] failed to enqueue directory event", error);
  }
}

export async function enqueueCareplusCaptureSafe(input: {
  businessId: string;
  eventType: Extract<
    CareplusEventType,
    "incident.captured" | "complaint.captured" | "action.captured" | "evidence.attached"
  >;
  recordId: string;
  customerId?: string;
  staffId?: string;
  jobId?: string;
  record: Record<string, unknown>;
}): Promise<"queued" | "skipped" | "exists"> {
  return enqueueCareplusRecord({
    eventId: `bms-${input.recordId}-${input.eventType}-v1`,
    eventType: input.eventType,
    businessId: input.businessId,
    occurredAt: new Date().toISOString(),
    source: {
      recordId: input.recordId,
      jobId: input.jobId,
      customerId: input.customerId,
      staffId: input.staffId,
      revision: 1,
    },
    record: input.record,
  });
}
