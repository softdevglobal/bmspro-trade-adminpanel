import "server-only";

import { defaultHourForTimeRange } from "@/lib/calendar/time-slots";
import { PERSONAL_EVENTS_COLLECTION } from "@/lib/calendar/personal-events/types";
import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import {
  REQUESTS_COLLECTION,
  isClockTime,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { notifyBusinessOfScheduleReminder } from "@/lib/notifications/server";
import {
  PLATFORM_TIME_ZONE,
  platformTodayIso,
  resolvePlatformTimeZone,
} from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { FieldValue } from "firebase-admin/firestore";

const DISPATCH_COLLECTION = "schedule_reminder_dispatches";

/** Cron interval is 5 min — catch reminders ~30 min before start. */
export const REMINDER_TARGET_LEAD_MS = 30 * 60 * 1000;
export const REMINDER_WINDOW_MS = 10 * 60 * 1000;

const REMINDER_MIN_LEAD_MS = REMINDER_TARGET_LEAD_MS - REMINDER_WINDOW_MS / 2;
const REMINDER_MAX_LEAD_MS = REMINDER_TARGET_LEAD_MS + REMINDER_WINDOW_MS / 2;

import type { ScheduleReminderKind } from "@/lib/scheduling/types";

type ReminderCandidate = {
  kind: ScheduleReminderKind;
  entityId: string;
  businessId: string;
  title: string;
  date: string;
  startTime: string;
};

function dispatchDocId(candidate: ReminderCandidate): string {
  return `${candidate.kind}:${candidate.entityId}:${candidate.date}:${candidate.startTime}`;
}

function isDueForReminder(startAtMs: number, nowMs: number): boolean {
  const lead = startAtMs - nowMs;
  return lead >= REMINDER_MIN_LEAD_MS && lead <= REMINDER_MAX_LEAD_MS;
}

function queryDatesAroundNow(): string[] {
  const dates = new Set<string>();
  for (const offset of [-1, 0, 1]) {
    dates.add(
      platformTodayIso(
        new Date(Date.now() + offset * 86_400_000),
        PLATFORM_TIME_ZONE,
      ),
    );
  }
  return Array.from(dates);
}

function resolveStartTime(
  explicit: string | null | undefined,
  timeRange: InspectionTimeRange | null | undefined,
): string | null {
  if (explicit && isClockTime(explicit)) return explicit;
  if (timeRange) return defaultHourForTimeRange(timeRange);
  return null;
}

function jobTitle(data: ReturnType<typeof mapBookingDoc>): string {
  return (
    data.serviceName?.trim() ||
    data.customRequest?.title?.trim() ||
    data.bookingCode?.trim() ||
    "Scheduled job"
  );
}

function requestTitle(data: ReturnType<typeof mapInspectionDoc>): string {
  return (
    data.serviceName?.trim() ||
    data.customRequest?.title?.trim() ||
    "Inspection request"
  );
}

async function claimReminderDispatch(
  candidate: ReminderCandidate,
): Promise<boolean> {
  const ref = adminDb.collection(DISPATCH_COLLECTION).doc(dispatchDocId(candidate));
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, {
        kind: candidate.kind,
        entityId: candidate.entityId,
        businessId: candidate.businessId,
        date: candidate.date,
        startTime: candidate.startTime,
        sentAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  } catch (error) {
    console.error("[schedule-reminders] dispatch claim failed", {
      id: ref.id,
      error,
    });
    return false;
  }
}

async function loadBusinessTimeZone(
  businessId: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(businessId);
  if (cached) return cached;

  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    const tz = resolvePlatformTimeZone(snap.data()?.timezone);
    cache.set(businessId, tz);
    return tz;
  } catch {
    cache.set(businessId, PLATFORM_TIME_ZONE);
    return PLATFORM_TIME_ZONE;
  }
}

async function collectJobCandidates(dates: string[]): Promise<ReminderCandidate[]> {
  const candidates: ReminderCandidate[] = [];
  const seen = new Set<string>();

  for (const date of dates) {
    const snap = await adminDb
      .collection(JOBS_COLLECTION)
      .where("scheduledSlot.date", "==", date)
      .get();

    for (const doc of snap.docs) {
      const booking = mapBookingDoc(doc.id, doc.data() ?? {});
      if (booking.status !== "scheduled") continue;
      if (!booking.businessId || !booking.scheduledSlot?.date) continue;

      const startTime = resolveStartTime(
        booking.scheduledStartTime,
        booking.scheduledSlot.timeRange,
      );
      if (!startTime) continue;

      const key = `job:${doc.id}:${booking.scheduledSlot.date}:${startTime}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        kind: "job",
        entityId: doc.id,
        businessId: booking.businessId,
        title: jobTitle(booking),
        date: booking.scheduledSlot.date,
        startTime,
      });
    }
  }

  return candidates;
}

async function collectInspectionCandidates(
  dates: string[],
): Promise<ReminderCandidate[]> {
  const candidates: ReminderCandidate[] = [];
  const seen = new Set<string>();

  for (const date of dates) {
    const snap = await adminDb
      .collection(REQUESTS_COLLECTION)
      .where("scheduledSlot.date", "==", date)
      .get();

    for (const doc of snap.docs) {
      const request = mapInspectionDoc(doc.id, doc.data() ?? {});
      if (request.status !== "scheduled") continue;
      if (!request.businessId || !request.scheduledSlot?.date) continue;

      const startTime = resolveStartTime(
        request.scheduledStartTime,
        request.scheduledSlot.timeRange,
      );
      if (!startTime) continue;

      const key = `inspection_request:${doc.id}:${request.scheduledSlot.date}:${startTime}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        kind: "inspection_request",
        entityId: doc.id,
        businessId: request.businessId,
        title: requestTitle(request),
        date: request.scheduledSlot.date,
        startTime,
      });
    }
  }

  return candidates;
}

async function collectPersonalEventCandidates(
  dates: string[],
): Promise<ReminderCandidate[]> {
  const candidates: ReminderCandidate[] = [];
  const seen = new Set<string>();

  for (const date of dates) {
    const snap = await adminDb
      .collection(PERSONAL_EVENTS_COLLECTION)
      .where("date", "==", date)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data() ?? {};
      const businessId =
        typeof data.businessId === "string" ? data.businessId.trim() : "";
      const eventDate = typeof data.date === "string" ? data.date : "";
      const startTime =
        typeof data.startTime === "string" && isClockTime(data.startTime)
          ? data.startTime
          : null;
      const title =
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : "Personal event";

      if (!businessId || !eventDate || !startTime) continue;

      const key = `personal_event:${doc.id}:${eventDate}:${startTime}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        kind: "personal_event",
        entityId: doc.id,
        businessId,
        title,
        date: eventDate,
        startTime,
      });
    }
  }

  return candidates;
}

export type ScheduleReminderRunResult = {
  scanned: number;
  due: number;
  sent: number;
  skipped: number;
};

export type ScheduleReminderDebugItem = ReminderCandidate & {
  timeZone: string;
  startAtMs: number | null;
  leadMinutes: number | null;
  due: boolean;
  dispatched: boolean;
};

/** Lists upcoming items with lead times (for troubleshooting). */
export async function debugScheduleReminders(): Promise<ScheduleReminderDebugItem[]> {
  const nowMs = Date.now();
  const dates = queryDatesAroundNow();
  const timeZoneCache = new Map<string, string>();

  const [jobs, inspections, events] = await Promise.all([
    collectJobCandidates(dates),
    collectInspectionCandidates(dates),
    collectPersonalEventCandidates(dates),
  ]);

  const items: ScheduleReminderDebugItem[] = [];

  for (const candidate of [...jobs, ...inspections, ...events]) {
    const timeZone = await loadBusinessTimeZone(
      candidate.businessId,
      timeZoneCache,
    );
    const startAtMs = zonedDateTimeToUtcMs(
      candidate.date,
      candidate.startTime,
      timeZone,
    );
    const leadMinutes =
      startAtMs === null ? null : Math.round((startAtMs - nowMs) / 60_000);
    const due =
      startAtMs !== null && isDueForReminder(startAtMs, nowMs);

    let dispatched = false;
    if (due) {
      const snap = await adminDb
        .collection(DISPATCH_COLLECTION)
        .doc(dispatchDocId(candidate))
        .get();
      dispatched = snap.exists;
    }

    items.push({
      ...candidate,
      timeZone,
      startAtMs,
      leadMinutes,
      due,
      dispatched,
    });
  }

  return items.sort((a, b) => (a.leadMinutes ?? 9999) - (b.leadMinutes ?? 9999));
}

/** Finds calendar items starting in ~30 minutes and notifies business admins. */
export async function runScheduleReminders(): Promise<ScheduleReminderRunResult> {
  const nowMs = Date.now();
  const dates = queryDatesAroundNow();
  const timeZoneCache = new Map<string, string>();

  const [jobs, inspections, events] = await Promise.all([
    collectJobCandidates(dates),
    collectInspectionCandidates(dates),
    collectPersonalEventCandidates(dates),
  ]);

  const candidates = [...jobs, ...inspections, ...events];
  let due = 0;
  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const timeZone = await loadBusinessTimeZone(
      candidate.businessId,
      timeZoneCache,
    );
    const startAtMs = zonedDateTimeToUtcMs(
      candidate.date,
      candidate.startTime,
      timeZone,
    );
    if (startAtMs === null || !isDueForReminder(startAtMs, nowMs)) {
      continue;
    }

    due += 1;
    const claimed = await claimReminderDispatch(candidate);
    if (!claimed) {
      skipped += 1;
      continue;
    }

    await notifyBusinessOfScheduleReminder({
      ...candidate,
      timeZone,
    });
    sent += 1;
  }

  return {
    scanned: candidates.length,
    due,
    sent,
    skipped,
  };
}
