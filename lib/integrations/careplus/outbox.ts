import "server-only";

import { logAuditEvent } from "@/lib/audit/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  CareplusClientError,
  retryAfterSecondsFromError,
  sendCareplusJobCompleted,
  sendCareplusRecord,
} from "@/lib/integrations/careplus/client";
import {
  CAREPLUS_BACKOFF_SECONDS,
  CAREPLUS_OUTBOX_BATCH_SIZE,
  CAREPLUS_OUTBOX_COLLECTION,
  CAREPLUS_OUTBOX_MAX_ATTEMPTS,
} from "@/lib/integrations/careplus/constants";
import { touchCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import type {
  CareplusJobCompletedPayload,
  CareplusOutboxRecord,
  CareplusOutboxStatus,
  CareplusReceipt,
  CareplusReceiptCorrection,
} from "@/lib/integrations/careplus/types";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Query,
} from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapOutboxDoc(
  eventId: string,
  data: DocumentData,
): CareplusOutboxRecord {
  const status = (
    ["pending", "retry", "sent", "failed"] as CareplusOutboxStatus[]
  ).includes(data.status)
    ? (data.status as CareplusOutboxStatus)
    : "pending";
  const corrections = Array.isArray(data.corrections)
    ? data.corrections.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.message !== "string") return [];
        const correction: CareplusReceiptCorrection = {
          field: typeof row.field === "string" ? row.field : "record",
          message: row.message,
        };
        return [correction];
      })
    : [];
  return {
    eventId,
    businessId: asString(data.businessId) ?? "",
    eventType: asString(data.eventType) ?? "job.completed",
    jobId: asString(data.jobId) ?? "",
    payloadHash: asString(data.payloadHash) ?? "",
    rawBody: asString(data.rawBody) ?? "",
    status,
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    nextAttemptAt: toMillis(data.nextAttemptAt),
    lastStatus: typeof data.lastStatus === "number" ? data.lastStatus : null,
    lastErrorCode: asString(data.lastErrorCode),
    processingStatus: asString(data.processingStatus),
    careplusRecordId: asString(data.careplusRecordId),
    careplusResource: asString(data.careplusResource),
    corrections,
    createdAt: toMillis(data.createdAt),
    sentAt: toMillis(data.sentAt),
  };
}

function nextBackoffMs(attempts: number): number {
  const seconds =
    CAREPLUS_BACKOFF_SECONDS[
      Math.min(attempts, CAREPLUS_BACKOFF_SECONDS.length) - 1
    ] ?? CAREPLUS_BACKOFF_SECONDS[CAREPLUS_BACKOFF_SECONDS.length - 1];
  return seconds * 1000;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function receiptStillPending(receipt: CareplusReceipt | null): boolean {
  return !receipt || receipt.status === "accepted" || receipt.status === "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** CarePlus /records is not live; send visit completions to the events API. */
function eventsBodyForVisit(claimed: CareplusOutboxRecord): string {
  if (claimed.eventType === "job.completed") return claimed.rawBody;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = asRecord(JSON.parse(claimed.rawBody));
  } catch {
    parsed = {};
  }
  const source = asRecord(parsed.source);
  const record = asRecord(parsed.record);
  const jobId =
    claimed.jobId ||
    asString(source.jobId) ||
    asString(source.recordId) ||
    "";
  const payload: CareplusJobCompletedPayload = {
    eventId: `bms-${jobId}-completed-v1`,
    eventType: "job.completed",
    businessId: claimed.businessId,
    jobId,
    title: asString(record.title) || `Completed job ${jobId}`,
    occurredAt: asString(parsed.occurredAt) || new Date().toISOString(),
  };
  const customerId = asString(record.customerId) || asString(source.customerId);
  const staffId = asString(record.staffId) || asString(source.staffId);
  if (customerId) payload.customerId = customerId;
  if (staffId) payload.staffId = staffId;
  return JSON.stringify(payload);
}

export async function listCareplusOutbox(
  businessId?: string,
  limit = 40,
): Promise<CareplusOutboxRecord[]> {
  let query: Query = adminDb.collection(
    CAREPLUS_OUTBOX_COLLECTION,
  );
  if (businessId?.trim()) {
    query = query.where("businessId", "==", businessId.trim());
  }
  const snap = await query.limit(Math.min(100, Math.max(1, limit))).get();
  return snap.docs
    .map((doc) => mapOutboxDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function processCareplusOutbox(options?: {
  businessId?: string;
  limit?: number;
  ignoreBackoff?: boolean;
}): Promise<{ scanned: number; sent: number; failed: number; retried: number }> {
  const snap = await adminDb
    .collection(CAREPLUS_OUTBOX_COLLECTION)
    .where("status", "in", ["pending", "retry"])
    .limit(CAREPLUS_OUTBOX_BATCH_SIZE)
    .get();

  const now = Date.now();
  const due = snap.docs.filter((doc) => {
    const data = doc.data() ?? {};
    if (
      options?.businessId &&
      data.businessId !== options.businessId.trim()
    ) {
      return false;
    }
    if (options?.ignoreBackoff) return true;
    const nextAttemptAt = toMillis(data.nextAttemptAt);
    return nextAttemptAt == null || nextAttemptAt <= now;
  });

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const doc of due.slice(0, options?.limit ?? due.length)) {
    const claimed = await claimOutboxEvent(doc.id, options?.ignoreBackoff);
    if (!claimed) continue;

    const started = Date.now();
    try {
      const result =
        claimed.eventType === "job.completed"
          ? await sendCareplusJobCompleted({
              businessId: claimed.businessId,
              rawBody: eventsBodyForVisit(claimed),
            })
          : await sendCareplusRecord({
              businessId: claimed.businessId,
              rawBody: claimed.rawBody,
            });
      if (receiptStillPending(result.receipt)) {
        throw new CareplusClientError(
          503,
          "processing_incomplete",
          "CarePlus accepted the event but has not finished creating the record.",
        );
      }
      await markOutboxSent(claimed.eventId, result.status, result.receipt);
      await touchCareplusIntegration(claimed.businessId, {
        lastEventStatus: result.receipt?.status || String(result.status),
        lastEventAt: FieldValue.serverTimestamp(),
        lastErrorCode: result.receipt?.corrections[0]?.message ?? null,
      });
      await logAuditEvent({
        businessId: claimed.businessId,
        category: "integration",
        action: "careplus.event_sent",
        actor: { uid: null, role: "system", name: "CarePlus outbox", email: null },
        source: "system",
        summary: `CarePlus ${claimed.eventType} sent for ${claimed.jobId}`,
        targetId: claimed.eventId,
        targetLabel: claimed.jobId,
        metadata: {
          eventId: claimed.eventId,
          jobId: claimed.jobId,
          eventType: claimed.eventType,
          httpStatus: result.status,
          processingStatus: result.receipt?.status ?? null,
          durationMs: Date.now() - started,
        },
      });
      sent += 1;
    } catch (error) {
      const status = error instanceof CareplusClientError ? error.status : 0;
      const code =
        error instanceof CareplusClientError
          ? error.code
          : "network_error";
      const retryAfter = retryAfterSecondsFromError(error);
      const willRetry =
        shouldRetryStatus(status || 503) &&
        claimed.attempts < CAREPLUS_OUTBOX_MAX_ATTEMPTS;

      await markOutboxAttempt({
        eventId: claimed.eventId,
        attempts: claimed.attempts,
        status,
        code,
        retry: willRetry,
        retryAfterSeconds: retryAfter,
      });
      await touchCareplusIntegration(claimed.businessId, {
        lastEventStatus: status ? String(status) : "error",
        lastEventAt: FieldValue.serverTimestamp(),
        lastErrorCode: code,
      });
      await logAuditEvent({
        businessId: claimed.businessId,
        category: "integration",
        action: willRetry ? "careplus.event_retry" : "careplus.event_failed",
        actor: { uid: null, role: "system", name: "CarePlus outbox", email: null },
        source: "system",
        summary: willRetry
          ? `CarePlus ${claimed.eventType} will retry for ${claimed.jobId}`
          : `CarePlus ${claimed.eventType} failed for ${claimed.jobId}`,
        targetId: claimed.eventId,
        targetLabel: claimed.jobId,
        metadata: {
          eventId: claimed.eventId,
          jobId: claimed.jobId,
          httpStatus: status || null,
          errorCode: code,
          durationMs: Date.now() - started,
        },
      });
      if (willRetry) retried += 1;
      else failed += 1;
    }
  }

  return { scanned: due.length, sent, failed, retried };
}

async function claimOutboxEvent(
  eventId: string,
  ignoreBackoff = false,
): Promise<CareplusOutboxRecord | null> {
  const ref = adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(eventId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const current = mapOutboxDoc(snap.id, snap.data() ?? {});
    if (current.status !== "pending" && current.status !== "retry") {
      return null;
    }
    if (
      !ignoreBackoff &&
      current.nextAttemptAt &&
      current.nextAttemptAt > Date.now()
    ) {
      return null;
    }
    tx.update(ref, {
      attempts: current.attempts + 1,
      lastErrorCode: null,
    });
    return { ...current, attempts: current.attempts + 1 };
  });
}

async function markOutboxSent(
  eventId: string,
  httpStatus: number,
  receipt: CareplusReceipt | null,
): Promise<void> {
  await adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(eventId).update({
    status: "sent",
    lastStatus: httpStatus,
    lastErrorCode: receipt?.corrections[0]?.message ?? null,
    processingStatus: receipt?.status ?? "processed",
    careplusRecordId: receipt?.careplusRecordId ?? null,
    careplusResource: receipt?.careplusResource ?? null,
    corrections: receipt?.corrections ?? [],
    sentAt: FieldValue.serverTimestamp(),
    nextAttemptAt: null,
  });
}

async function markOutboxAttempt(input: {
  eventId: string;
  attempts: number;
  status: number;
  code: string;
  retry: boolean;
  retryAfterSeconds: number | null;
}): Promise<void> {
  const delayMs =
    input.retryAfterSeconds && input.retryAfterSeconds > 0
      ? input.retryAfterSeconds * 1000
      : nextBackoffMs(input.attempts);
  await adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(input.eventId).update({
    status: input.retry ? "retry" : "failed",
    lastStatus: input.status || null,
    lastErrorCode: input.code,
    nextAttemptAt: input.retry
      ? Timestamp.fromMillis(Date.now() + delayMs)
      : null,
  });
}

export async function retryCareplusOutboxEvent(eventId: string): Promise<CareplusOutboxRecord> {
  const ref = adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(eventId.trim());
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Outbox event not found.");
  const current = mapOutboxDoc(snap.id, snap.data() ?? {});
  if (
    current.status !== "failed" &&
    current.status !== "retry" &&
    current.status !== "pending" &&
    current.status !== "sent" &&
    current.processingStatus !== "correction_required" &&
    current.processingStatus !== "accepted"
  ) {
    throw new Error("Only failed, waiting, corrected, incomplete, or delivered events can be queued again.");
  }
  await ref.update({
    status: "pending",
    nextAttemptAt: Timestamp.fromMillis(Date.now()),
    lastErrorCode: null,
  });
  const saved = await ref.get();
  return mapOutboxDoc(saved.id, saved.data() ?? {});
}
