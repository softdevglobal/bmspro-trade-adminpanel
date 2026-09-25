import "server-only";

import { createHash } from "node:crypto";

import { adminDb } from "@/lib/firebase/admin";
import {
  buildCaptureEnvelope,
  type CareplusCaptureEventType,
  type CareplusCaptureKind,
  captureKindFromEventType,
  isAmendCaptureEvent,
  nextCaptureRevision,
} from "@/lib/integrations/careplus/capture-records";
import { isCareplusSecretConfigured } from "@/lib/integrations/careplus/config";
import {
  CAREPLUS_CAPTURES_COLLECTION,
  CAREPLUS_OUTBOX_COLLECTION,
} from "@/lib/integrations/careplus/constants";
import {
  activeCustomerCareplusId,
  activeStaffCareplusId,
  getCareplusIntegration,
} from "@/lib/integrations/careplus/mapping";
import { deliverCareplusOutboxEvent, parkCareplusOutboxFailure } from "@/lib/integrations/careplus/outbox";
import type {
  CareplusEnqueueInput,
  CareplusEnqueueResult,
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

function wroteNewEvent(result: CareplusEnqueueResult): boolean {
  return (
    result === "queued" ||
    result === "sent" ||
    result === "failed" ||
    result === "retry"
  );
}

async function writeCareplusOutboxDoc(
  payload: CareplusRecordPayload | CareplusJobCompletedPayload,
  jobId: string,
  origin: "tenant" | "system",
): Promise<"queued" | "exists"> {
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
      return "exists" as const;
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
      origin,
      createdAt: FieldValue.serverTimestamp(),
      sentAt: null,
    });
    return "queued" as const;
  });
}

async function settleCareplusDelivery(
  eventId: string,
  mapping: NonNullable<Awaited<ReturnType<typeof getCareplusIntegration>>>,
): Promise<CareplusEnqueueResult> {
  try {
    const delivery = await deliverCareplusOutboxEvent(eventId, {
      ignoreBackoff: true,
      mapping,
    });
    if (delivery === "sent") return "sent";
    if (delivery === "awaiting") return "queued";
    if (delivery === "failed") return "failed";
    if (delivery === "retried") return "retry";
    if (delivery === "skipped") return "skipped";
    return "queued";
  } catch (error) {
    console.error("[careplus] immediate delivery failed", error);
    return "queued";
  }
}

export async function enqueueCareplusRecord(
  payload: CareplusRecordPayload | CareplusJobCompletedPayload,
  jobId = "",
): Promise<CareplusEnqueueResult> {
  if (!payload.eventId || !payload.businessId) return "skipped";

  const mapping = await getCareplusIntegration(payload.businessId);
  if (!mapping || mapping.status !== "active") return "skipped";
  if (!isCareplusSecretConfigured(payload.businessId)) return "skipped";

  const written = await writeCareplusOutboxDoc(payload, jobId, "system");
  if (written !== "queued") return written;
  return settleCareplusDelivery(payload.eventId, mapping);
}

export async function enqueueCareplusJobCompleted(
  input: CareplusEnqueueInput,
): Promise<CareplusEnqueueResult> {
  if (!input.id || !input.businessId) return "skipped";
  const payload = await buildCareplusActivityCompletedPayload(input);
  const queued = await enqueueCareplusRecord(payload, input.id);
  if (wroteNewEvent(queued)) {
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
    console.error("[careplus] failed to send job.completed", error);
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
    if (wroteNewEvent(queued)) {
      await persistJobCareplusRevision(
        input.id,
        payload.source.revision,
        resolved === "activity.scheduled" || Boolean(input.careplusScheduled),
      );
    }
  } catch (error) {
    console.error(`[careplus] failed to send ${eventType}`, error);
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
    console.error("[careplus] failed to send directory event", error);
  }
}

async function readCaptureRevision(
  businessId: string,
  recordId: string,
): Promise<number | null> {
  const snap = await adminDb
    .collection(CAREPLUS_CAPTURES_COLLECTION)
    .doc(recordId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.businessId !== businessId) return null;
  return typeof data.revision === "number" && data.revision > 0
    ? data.revision
    : null;
}

async function persistCaptureRevision(input: {
  businessId: string;
  recordId: string;
  kind: CareplusCaptureKind;
  eventType: CareplusCaptureEventType;
  eventId: string;
  revision: number;
  title: string;
  customerId?: string;
}): Promise<void> {
  await adminDb.collection(CAREPLUS_CAPTURES_COLLECTION).doc(input.recordId).set(
    {
      recordId: input.recordId,
      businessId: input.businessId,
      kind: input.kind,
      eventType: input.eventType,
      lastEventId: input.eventId,
      revision: input.revision,
      title: input.title,
      customerId: input.customerId || null,
      updatedAt: FieldValue.serverTimestamp(),
      ...(input.revision === 1
        ? { createdAt: FieldValue.serverTimestamp() }
        : {}),
    },
    { merge: true },
  );
}

export async function enqueueCareplusCaptureSafe(input: {
  businessId: string;
  eventType: Extract<
    CareplusEventType,
    | "incident.captured"
    | "incident.amended"
    | "complaint.captured"
    | "complaint.amended"
    | "risk.captured"
    | "risk.amended"
    | "action.captured"
    | "evidence.attached"
    | "staff.credential.submitted"
  >;
  recordId: string;
  customerId?: string;
  staffId?: string;
  jobId?: string;
  record: Record<string, unknown>;
}): Promise<CareplusEnqueueResult> {
  const isOperationalCapture =
    input.eventType.startsWith("incident.") ||
    input.eventType.startsWith("complaint.") ||
    input.eventType.startsWith("risk.");

  if (isOperationalCapture) {
    const eventType = input.eventType as CareplusCaptureEventType;
    const kind = captureKindFromEventType(eventType);
    const previous = await readCaptureRevision(input.businessId, input.recordId);
    if (isAmendCaptureEvent(eventType) && previous === null) {
      throw new Error("Amend requires an existing CarePlus capture record.");
    }
    const revision = isAmendCaptureEvent(eventType)
      ? nextCaptureRevision(previous)
      : 1;

    // Prefer mapped CarePlus ids when present; otherwise keep the BMS id so
    // CarePlus can park as pending_mapping. Never invent CarePlus ids.
    const mappedCustomer =
      (await activeCustomerCareplusId(input.businessId, input.customerId)) ||
      input.customerId?.trim() ||
      "";
    const mappedStaff =
      (await activeStaffCareplusId(input.businessId, input.staffId)) ||
      input.staffId?.trim() ||
      "";

    const record = { ...input.record };
    if (record.anonymous === true) {
      delete record.customerId;
    } else if (mappedCustomer) {
      record.customerId = mappedCustomer;
    }
    if (kind === "complaint" && mappedStaff) {
      record.ownerId = mappedStaff;
    }

    const envelope = buildCaptureEnvelope({
      businessId: input.businessId,
      recordId: input.recordId,
      eventType,
      revision,
      customerId: record.anonymous === true ? "" : mappedCustomer,
      staffId: mappedStaff,
      jobId: input.jobId,
      record,
    });

    const payload: CareplusRecordPayload = envelope;
    const written = await writeCareplusOutboxDoc(
      payload,
      input.jobId ?? input.recordId,
      "tenant",
    );
    if (written !== "queued") return written;

    await persistCaptureRevision({
      businessId: input.businessId,
      recordId: input.recordId,
      kind,
      eventType,
      eventId: payload.eventId,
      revision,
      title:
        typeof input.record.title === "string" ? input.record.title : input.recordId,
      customerId: mappedCustomer,
    });

    const mapping = await getCareplusIntegration(payload.businessId);
    if (!mapping || mapping.status !== "active") {
      await parkCareplusOutboxFailure(payload.eventId, "mapping_inactive");
      return "failed";
    }
    if (!isCareplusSecretConfigured(payload.businessId)) {
      await parkCareplusOutboxFailure(payload.eventId, "secret_missing");
      return "failed";
    }

    const result = await settleCareplusDelivery(payload.eventId, mapping);
    if (
      result === "sent" ||
      result === "queued" ||
      result === "retry" ||
      result === "failed"
    ) {
      return result;
    }
    await parkCareplusOutboxFailure(payload.eventId, "delivery_skipped");
    return "failed";
  }

  const payload: CareplusRecordPayload = {
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
  };
  if (!payload.eventId || !payload.businessId) return "skipped";

  const written = await writeCareplusOutboxDoc(payload, input.jobId ?? input.recordId, "tenant");
  if (written !== "queued") return written;

  const mapping = await getCareplusIntegration(payload.businessId);
  if (!mapping || mapping.status !== "active") {
    await parkCareplusOutboxFailure(payload.eventId, "mapping_inactive");
    return "failed";
  }
  if (!isCareplusSecretConfigured(payload.businessId)) {
    await parkCareplusOutboxFailure(payload.eventId, "secret_missing");
    return "failed";
  }

  const result = await settleCareplusDelivery(payload.eventId, mapping);
  if (result === "sent" || result === "queued" || result === "retry" || result === "failed") {
    return result;
  }
  await parkCareplusOutboxFailure(payload.eventId, "delivery_skipped");
  return "failed";
}
