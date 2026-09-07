import "server-only";

import { logAuditEvent } from "@/lib/audit/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  CareplusClientError,
  retryAfterSecondsFromError,
  sendCareplusJobCompleted,
} from "@/lib/integrations/careplus/client";
import {
  CAREPLUS_BACKOFF_SECONDS,
  CAREPLUS_OUTBOX_BATCH_SIZE,
  CAREPLUS_OUTBOX_COLLECTION,
  CAREPLUS_OUTBOX_MAX_ATTEMPTS,
} from "@/lib/integrations/careplus/constants";
import { touchCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import type {
  CareplusOutboxRecord,
  CareplusOutboxStatus,
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
  return {
    eventId,
    businessId: asString(data.businessId) ?? "",
    eventType: "job.completed",
    jobId: asString(data.jobId) ?? "",
    payloadHash: asString(data.payloadHash) ?? "",
    rawBody: asString(data.rawBody) ?? "",
    status,
    attempts: typeof data.attempts === "number" ? data.attempts : 0,
    nextAttemptAt: toMillis(data.nextAttemptAt),
    lastStatus: typeof data.lastStatus === "number" ? data.lastStatus : null,
    lastErrorCode: asString(data.lastErrorCode),
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
    const nextAttemptAt = toMillis(data.nextAttemptAt);
    return nextAttemptAt == null || nextAttemptAt <= now;
  });

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const doc of due.slice(0, options?.limit ?? due.length)) {
    const claimed = await claimOutboxEvent(doc.id);
    if (!claimed) continue;

    const started = Date.now();
    try {
      const result = await sendCareplusJobCompleted({
        businessId: claimed.businessId,
        rawBody: claimed.rawBody,
      });
      await markOutboxSent(claimed.eventId, result.status);
      await touchCareplusIntegration(claimed.businessId, {
        lastEventStatus: String(result.status),
        lastEventAt: FieldValue.serverTimestamp(),
        lastErrorCode: null,
      });
      await logAuditEvent({
        businessId: claimed.businessId,
        category: "integration",
        action: "careplus.event_sent",
        actor: { uid: null, role: "system", name: "CarePlus outbox", email: null },
        source: "system",
        summary: `CarePlus job.completed sent for ${claimed.jobId}`,
        targetId: claimed.eventId,
        targetLabel: claimed.jobId,
        metadata: {
          eventId: claimed.eventId,
          jobId: claimed.jobId,
          httpStatus: result.status,
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
          ? `CarePlus job.completed will retry for ${claimed.jobId}`
          : `CarePlus job.completed failed for ${claimed.jobId}`,
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
): Promise<CareplusOutboxRecord | null> {
  const ref = adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(eventId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const current = mapOutboxDoc(snap.id, snap.data() ?? {});
    if (current.status !== "pending" && current.status !== "retry") {
      return null;
    }
    if (current.nextAttemptAt && current.nextAttemptAt > Date.now()) {
      return null;
    }
    tx.update(ref, {
      attempts: current.attempts + 1,
      lastErrorCode: null,
    });
    return { ...current, attempts: current.attempts + 1 };
  });
}

async function markOutboxSent(eventId: string, httpStatus: number): Promise<void> {
  await adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(eventId).update({
    status: "sent",
    lastStatus: httpStatus,
    lastErrorCode: null,
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
