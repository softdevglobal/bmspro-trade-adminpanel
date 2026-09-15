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

type CareplusActivityEvent = Extract<
  CareplusEventType,
  | "activity.scheduled"
  | "activity.completed"
  | "activity.amended"
  | "activity.cancelled"
  | "activity.missed"
>;

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

function minutesBetween(start: string, end: string): number | null {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 5) return null;
  return Math.min(1440, minutes);
}

function plannedClock(input: CareplusEnqueueInput): {
  date: string;
  time: string;
  duration: number;
} {
  const date =
    input.scheduledSlot?.date ||
    clockFromInstant(input.visitStartedAt)?.date ||
    new Date().toISOString().slice(0, 10);
  const time =
    input.scheduledStartTime?.slice(0, 5) ||
    input.scheduledSlot?.startTime?.slice(0, 5) ||
    clockFromInstant(input.visitStartedAt)?.time ||
    "09:00";
  const end =
    input.scheduledEndTime?.slice(0, 5) ||
    input.scheduledSlot?.endTime?.slice(0, 5) ||
    "";
  const duration =
    (typeof input.estimatedDurationMinutes === "number" &&
    input.estimatedDurationMinutes >= 5
      ? Math.min(1440, Math.round(input.estimatedDurationMinutes))
      : null) ||
    (end ? minutesBetween(time, end) : null) ||
    60;
  return { date, time, duration };
}

function actualClock(input: CareplusEnqueueInput): {
  date: string;
  time: string;
  duration: number;
} | null {
  const started = clockFromInstant(input.visitStartedAt);
  const ended = clockFromInstant(input.visitEndedAt);
  if (!started && !ended) return null;
  const date = started?.date || ended?.date || "";
  const time = started?.time || ended?.time || "09:00";
  const duration =
    input.visitStartedAt && input.visitEndedAt
      ? Math.min(
          1440,
          Math.max(5, Math.round((input.visitEndedAt - input.visitStartedAt) / 60000)),
        )
      : plannedClock(input).duration;
  return { date, time, duration };
}

function visitNotes(input: CareplusEnqueueInput, eventType: CareplusActivityEvent): string {
  const recorded =
    input.jobInstructionsDescription?.trim() ||
    input.ownerNote?.trim() ||
    input.customRequest?.description?.trim() ||
    "";
  if (recorded) return recorded;
  if (eventType === "activity.completed") {
    return `BMS job ${input.bookingCode || input.id} completed.`;
  }
  if (eventType === "activity.missed") {
    return input.missedReason?.trim() || `BMS job ${input.bookingCode || input.id} was missed.`;
  }
  return "";
}

function nextRevision(input: CareplusEnqueueInput): number {
  const current = input.careplusSourceRevision;
  if (typeof current === "number" && Number.isInteger(current) && current > 0) {
    return current + 1;
  }
  return 1;
}

function activityEventId(input: CareplusEnqueueInput, eventType: CareplusActivityEvent): string {
  if (eventType === "activity.scheduled") return `bms-${input.id}-activity-scheduled-v1`;
  if (eventType === "activity.completed") return `bms-${input.id}-activity-completed-v1`;
  if (eventType === "activity.cancelled") return `bms-${input.id}-activity-cancelled-v1`;
  if (eventType === "activity.missed") return `bms-${input.id}-activity-missed-v1`;
  return `bms-${input.id}-activity-amended-r${nextRevision(input)}`;
}

async function persistJobCareplusRevision(
  jobId: string,
  revision: number,
  scheduled: boolean,
): Promise<void> {
  if (!jobId || revision < 1) return;
  try {
    await adminDb.collection("jobs").doc(jobId).update({
      careplusSourceRevision: revision,
      ...(scheduled ? { careplusScheduled: true } : {}),
    });
  } catch (error) {
    console.error("[careplus] failed to persist source revision", error);
  }
}

export async function buildCareplusActivityPayload(
  input: CareplusEnqueueInput,
  eventType: CareplusActivityEvent,
): Promise<CareplusRecordPayload> {
  const customerId =
    (await activeCustomerCareplusId(input.businessId, input.customerId)) ||
    input.customerId?.trim() ||
    "";
  const staffId =
    (await activeStaffCareplusId(input.businessId, input.assignedTo?.uid)) ||
    input.assignedTo?.uid?.trim() ||
    "";
  const planned = plannedClock(input);
  const actual = eventType === "activity.completed" ? actualClock(input) : null;
  const display = actual || planned;
  const revision = nextRevision(input);
  const status =
    eventType === "activity.cancelled"
      ? "cancelled"
      : eventType === "activity.missed"
        ? "missed"
        : eventType === "activity.scheduled"
          ? "scheduled"
          : eventType === "activity.amended"
            ? "scheduled"
            : "completed";
  return {
    eventId: activityEventId(input, eventType),
    eventType,
    businessId: input.businessId,
    occurredAt: new Date().toISOString(),
    source: {
      recordId: input.id,
      jobId: input.id,
      customerId,
      staffId,
      revision,
    },
    record: {
      title: jobTitle(input),
      customerId,
      staffId,
      staffIds: staffId ? [staffId] : [],
      serviceName: input.serviceName?.trim() || "",
      date: display.date,
      time: display.time,
      duration: display.duration,
      timezone: input.timezone?.trim() || "Australia/Sydney",
      plannedDate: planned.date,
      plannedTime: planned.time,
      plannedDuration: planned.duration,
      actualDate: actual?.date || "",
      actualTime: actual?.time || "",
      actualDuration: actual?.duration || 0,
      seriesId: input.seriesId?.trim() || "",
      occurrenceId: input.id,
      notes: visitNotes(input, eventType),
      missedReason: input.missedReason?.trim() || "",
      amendmentReason:
        input.amendmentReason?.trim() ||
        (eventType === "activity.amended" ? "Visit details updated from BMS." : ""),
      status,
    },
  };
}

export async function buildCareplusActivityCompletedPayload(
  input: CareplusEnqueueInput,
): Promise<CareplusRecordPayload> {
  return buildCareplusActivityPayload(input, "activity.completed");
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
  const payload = await buildCareplusActivityCompletedPayload(input);
  const queued = await enqueueCareplusRecord(payload, input.id);
  if (queued === "queued") {
    await persistJobCareplusRevision(input.id, payload.source.revision, true);
  }
  return queued;
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

export function resolveCareplusVisitEvent(
  input: Pick<CareplusEnqueueInput, "careplusScheduled">,
  preferred: CareplusActivityEvent,
): CareplusActivityEvent {
  if (
    preferred === "activity.scheduled" &&
    input.careplusScheduled
  ) {
    return "activity.amended";
  }
  return preferred;
}

export async function enqueueCareplusActivitySafe(
  input: CareplusEnqueueInput,
  eventType: CareplusActivityEvent,
): Promise<void> {
  if (!input.id || !input.businessId) return;
  try {
    const resolved = resolveCareplusVisitEvent(input, eventType);
    const payload = await buildCareplusActivityPayload(input, resolved);
    const queued = await enqueueCareplusRecord(payload, input.id);
    if (queued === "queued") {
      await persistJobCareplusRevision(
        input.id,
        payload.source.revision,
        resolved === "activity.scheduled" || Boolean(input.careplusScheduled),
      );
    }
  } catch (error) {
    console.error(`[careplus] failed to enqueue ${eventType}`, error);
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
    | "incident.captured"
    | "complaint.captured"
    | "risk.captured"
    | "action.captured"
    | "evidence.attached"
    | "staff.credential.submitted"
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
