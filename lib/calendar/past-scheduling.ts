import { parseClockMinutes } from "@/lib/leave/clock";
import {
  currentClockMinutesInTimeZone,
  isIsoDateBeforeToday,
  platformTodayIso,
} from "@/lib/platform/timezone";
import {
  TIME_RANGES,
  type InspectionTimeRange,
} from "@/lib/inspection/types";

export const PAST_DAY_HINT = "Past date — view only, new bookings disabled";
export const PAST_SESSION_HINT = "This time has already passed";
export const PAST_HOUR_SLOT_HINT = "This hour has already passed";

function timeRangeEndTime(timeRange: InspectionTimeRange): string {
  return timeRange === "morning" ? "12:00" : "17:00";
}

/** True when the calendar day is before today in the business timezone. */
export function isPastCalendarDate(
  isoDate: string,
  timeZone?: string | null,
  now = new Date(),
): boolean {
  return isIsoDateBeforeToday(isoDate, timeZone, now);
}

/** Morning/afternoon session has fully ended for today in the business timezone. */
export function isPastTimeRangeSession(
  isoDate: string,
  timeRange: InspectionTimeRange,
  timeZone?: string | null,
  now = new Date(),
): boolean {
  if (isPastCalendarDate(isoDate, timeZone, now)) return true;
  const today = platformTodayIso(now, timeZone);
  if (isoDate !== today) return false;

  const endTime = timeRangeEndTime(timeRange);
  const endMin = parseClockMinutes(endTime);
  if (endMin == null) return false;
  return currentClockMinutesInTimeZone(now, timeZone) >= endMin;
}

/** Hourly slot start time has passed for today in the business timezone. */
export function isPastHourSlot(
  isoDate: string,
  slotStartTime: string,
  timeZone?: string | null,
  now = new Date(),
): boolean {
  if (isPastCalendarDate(isoDate, timeZone, now)) return true;
  const today = platformTodayIso(now, timeZone);
  if (isoDate !== today) return false;

  const slotStartMin = parseClockMinutes(slotStartTime);
  if (slotStartMin == null) return false;
  return currentClockMinutesInTimeZone(now, timeZone) >= slotStartMin;
}

export type PastUnavailableSlot = {
  date: string;
  timeRange: InspectionTimeRange;
};

/** Past days and elapsed sessions today — merged into customer slot availability. */
export function pastUnavailableSlots(
  fromDate: string,
  toDate: string,
  timeZone: string,
  now = new Date(),
): PastUnavailableSlot[] {
  const today = platformTodayIso(now, timeZone);
  const nowMin = currentClockMinutesInTimeZone(now, timeZone);
  const unavailable: PastUnavailableSlot[] = [];

  let cursor = fromDate;
  while (cursor <= toDate) {
    if (cursor < today) {
      for (const timeRange of TIME_RANGES) {
        unavailable.push({ date: cursor, timeRange });
      }
    } else if (cursor === today) {
      for (const timeRange of TIME_RANGES) {
        const endTime = timeRangeEndTime(timeRange);
        const endMin = parseClockMinutes(endTime);
        if (endMin != null && nowMin >= endMin) {
          unavailable.push({ date: cursor, timeRange });
        }
      }
    }
    cursor = addDaysIso(cursor, 1);
  }

  return unavailable;
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
