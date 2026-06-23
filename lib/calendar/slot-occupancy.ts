import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import {
  DEFAULT_SLOT_CAPACITY,
  parseSlotCapacityFromBusiness,
  type SlotCapacitySettings,
} from "@/lib/calendar/slot-capacity";
import {
  parseWorkingHoursFromBusiness,
  resolveCalendarSlotBounds,
  type BusinessWorkingHours,
} from "@/lib/calendar/working-hours";
import { listPersonalCalendarEvents } from "@/lib/calendar/personal-events/server";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION, TIME_RANGES, type InspectionTimeRange } from "@/lib/inspection/types";
import { parseClockMinutes } from "@/lib/leave/clock";
import { isClockTime } from "@/lib/inspection/types";

export type HourSlotOccupancy = {
  startTime: string;
  endTime: string;
  jobCount: number;
  requestCount: number;
  personalCount: number;
  maxJobs: number;
  maxRequests: number;
  jobsFull: boolean;
  requestsFull: boolean;
};

export type DaySlotOccupancy = {
  date: string;
  capacity: SlotCapacitySettings;
  workingHours: BusinessWorkingHours;
  slots: HourSlotOccupancy[];
};

function hourSlotDefinitions(
  startHour: number,
  endHour: number,
): { startTime: string; endTime: string }[] {
  const slots: { startTime: string; endTime: string }[] = [];
  for (let hour = startHour; hour < endHour; hour += 1) {
    slots.push({
      startTime: `${String(hour).padStart(2, "0")}:00`,
      endTime: `${String(hour + 1).padStart(2, "0")}:00`,
    });
  }
  return slots;
}

function eventWindowMinutes(
  date: string,
  eventDate: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  fallbackStart: string,
  fallbackEnd: string,
): { startMin: number; endMin: number } | null {
  if (eventDate !== date) return null;

  let startMin = parseClockMinutes(startTime);
  let endMin = parseClockMinutes(endTime);

  if (startMin == null && endMin == null) {
    startMin = parseClockMinutes(fallbackStart);
    endMin = parseClockMinutes(fallbackEnd);
  } else if (startMin != null && endMin == null) {
    endMin = startMin + 60;
  } else if (startMin == null && endMin != null) {
    startMin = endMin - 60;
  }

  if (startMin == null || endMin == null || endMin <= startMin) return null;
  return { startMin, endMin };
}

function overlapsHourBucket(
  window: { startMin: number; endMin: number },
  slotStartMin: number,
): boolean {
  const slotEndMin = slotStartMin + 60;
  return window.startMin < slotEndMin && window.endMin > slotStartMin;
}

function defaultWindowForTimeRange(timeRange: "morning" | "afternoon"): {
  start: string;
  end: string;
} {
  return timeRange === "morning"
    ? { start: "10:00", end: "11:00" }
    : { start: "13:00", end: "14:00" };
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function hourSession(startTime: string): InspectionTimeRange {
  const hour = Number.parseInt(startTime.split(":")[0] ?? "", 10);
  return hour < 12 ? "morning" : "afternoon";
}

/** True when every hourly slot in the session is at inspection-request capacity. */
export function isSessionFullyBookedForRequests(
  slots: HourSlotOccupancy[],
  session: InspectionTimeRange,
): boolean {
  const sessionSlots = slots.filter(
    (slot) => hourSession(slot.startTime) === session,
  );
  if (sessionSlots.length === 0) return false;
  return sessionSlots.every((slot) => slot.requestsFull);
}

function buildHourSlotOccupancyForDate(
  date: string,
  capacity: SlotCapacitySettings,
  workingHours: BusinessWorkingHours,
  requestsSnap: Awaited<
    ReturnType<ReturnType<typeof adminDb.collection>["get"]>
  >,
  jobsSnap: Awaited<ReturnType<ReturnType<typeof adminDb.collection>["get"]>>,
  personalEvents: Awaited<ReturnType<typeof listPersonalCalendarEvents>>,
): HourSlotOccupancy[] {
  const { startHour, endHour } = resolveCalendarSlotBounds(workingHours);
  const slotDefs = hourSlotDefinitions(startHour, endHour);
  const windows: { jobs: number; requests: number; personal: number }[] =
    slotDefs.map(() => ({ jobs: 0, requests: 0, personal: 0 }));

  for (const doc of requestsSnap.docs) {
    const request = mapInspectionDoc(doc.id, doc.data() ?? {});
    if (request.status !== "scheduled") continue;
    const slot = request.scheduledSlot;
    if (!slot?.date) continue;
    const defaults = defaultWindowForTimeRange(slot.timeRange);
    const window = eventWindowMinutes(
      date,
      slot.date,
      request.scheduledStartTime,
      request.scheduledEndTime,
      defaults.start,
      defaults.end,
    );
    if (!window) continue;
    windows.forEach((bucket, index) => {
      const slotStartMin = startHour * 60 + index * 60;
      if (overlapsHourBucket(window, slotStartMin)) bucket.requests += 1;
    });
  }

  for (const doc of jobsSnap.docs) {
    const booking = mapBookingDoc(doc.id, doc.data() ?? {});
    if (booking.status !== "scheduled" && booking.status !== "ongoing") continue;
    const slot = booking.scheduledSlot;
    if (!slot?.date) continue;
    const defaults = defaultWindowForTimeRange(slot.timeRange);
    const window = eventWindowMinutes(
      date,
      slot.date,
      booking.scheduledStartTime,
      booking.scheduledEndTime,
      defaults.start,
      defaults.end,
    );
    if (!window) continue;
    windows.forEach((bucket, index) => {
      const slotStartMin = startHour * 60 + index * 60;
      if (overlapsHourBucket(window, slotStartMin)) bucket.jobs += 1;
    });
  }

  for (const event of personalEvents) {
    if (event.date !== date) continue;
    if (!isClockTime(event.startTime) || !isClockTime(event.endTime)) continue;
    const startMin = parseClockMinutes(event.startTime);
    const endMin = parseClockMinutes(event.endTime);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    const window = { startMin, endMin };
    windows.forEach((bucket, index) => {
      const slotStartMin = startHour * 60 + index * 60;
      if (overlapsHourBucket(window, slotStartMin)) bucket.personal += 1;
    });
  }

  return slotDefs.map((slot, index) => {
    const counts = windows[index]!;
    return {
      startTime: slot.startTime,
      endTime: slot.endTime,
      jobCount: counts.jobs,
      requestCount: counts.requests,
      personalCount: counts.personal,
      maxJobs: capacity.maxJobsPerHour,
      maxRequests: capacity.maxInspectionsPerHour,
      jobsFull: counts.jobs >= capacity.maxJobsPerHour,
      requestsFull: counts.requests >= capacity.maxInspectionsPerHour,
    };
  });
}

export async function loadBusinessSlotCapacity(
  businessId: string,
): Promise<SlotCapacitySettings> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) return DEFAULT_SLOT_CAPACITY;
  return parseSlotCapacityFromBusiness(snap.data() ?? {});
}

export async function loadBusinessWorkingHours(
  businessId: string,
): Promise<BusinessWorkingHours> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) {
    return parseWorkingHoursFromBusiness(null);
  }
  return parseWorkingHoursFromBusiness(snap.data() ?? {});
}

export async function computeDaySlotOccupancy(
  businessId: string,
  date: string,
): Promise<DaySlotOccupancy> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  const businessData = snap.exists ? (snap.data() ?? {}) : {};
  const capacity = parseSlotCapacityFromBusiness(businessData);
  const workingHours = parseWorkingHoursFromBusiness(businessData);

  const [requestsSnap, jobsSnap, personalEvents] = await Promise.all([
    adminDb
      .collection(REQUESTS_COLLECTION)
      .where("businessId", "==", businessId)
      .get(),
    adminDb.collection(JOBS_COLLECTION).where("businessId", "==", businessId).get(),
    listPersonalCalendarEvents(businessId),
  ]);

  const slots = buildHourSlotOccupancyForDate(
    date,
    capacity,
    workingHours,
    requestsSnap,
    jobsSnap,
    personalEvents,
  );

  return { date, capacity, workingHours, slots };
}

/** Morning/afternoon sessions where every hourly slot is at request capacity. */
export async function computeCapacityUnavailableSessions(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<{ date: string; timeRange: InspectionTimeRange }[]> {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    return [];
  }

  const snap = await adminDb.collection("businesses").doc(businessId).get();
  const businessData = snap.exists ? (snap.data() ?? {}) : {};
  const capacity = parseSlotCapacityFromBusiness(businessData);
  const workingHours = parseWorkingHoursFromBusiness(businessData);
  const [requestsSnap, jobsSnap, personalEvents] = await Promise.all([
    adminDb
      .collection(REQUESTS_COLLECTION)
      .where("businessId", "==", businessId)
      .get(),
    adminDb.collection(JOBS_COLLECTION).where("businessId", "==", businessId).get(),
    listPersonalCalendarEvents(businessId),
  ]);

  const unavailable: { date: string; timeRange: InspectionTimeRange }[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    const slots = buildHourSlotOccupancyForDate(
      cursor,
      capacity,
      workingHours,
      requestsSnap,
      jobsSnap,
      personalEvents,
    );
    for (const timeRange of TIME_RANGES) {
      if (isSessionFullyBookedForRequests(slots, timeRange)) {
        unavailable.push({ date: cursor, timeRange });
      }
    }
    cursor = addDaysIso(cursor, 1);
  }

  return unavailable;
}

export function rangeOverlapsFullSlots(
  slots: HourSlotOccupancy[],
  startTime: string,
  endTime: string,
  kind: "inspection" | "job",
): boolean {
  const startMin = parseClockMinutes(startTime);
  const endMin = parseClockMinutes(endTime);
  if (startMin == null || endMin == null || endMin <= startMin) return true;

  for (const slot of slots) {
    const slotStartMin = parseClockMinutes(slot.startTime);
    if (slotStartMin == null) continue;
    if (!overlapsHourBucket({ startMin, endMin }, slotStartMin)) continue;
    if (kind === "job" ? slot.jobsFull : slot.requestsFull) return true;
  }
  return false;
}
