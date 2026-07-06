import {
  isClockTime,
  sortInspectionSlots,
  type InspectionSlot,
} from "@/lib/inspection/types";
import {
  DEFAULT_WORKING_HOURS,
  type BusinessWorkingHours,
} from "@/lib/calendar/working-hours";
import { validateCalendarVisitWindow } from "@/lib/calendar/visit-window";

export type CalendarScheduleInput = {
  date: string;
  startTime: string;
  endTime: string;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseCalendarScheduleInput(
  raw: unknown,
  workingHours: BusinessWorkingHours = DEFAULT_WORKING_HOURS,
): CalendarScheduleInput | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const startTime =
    typeof input.startTime === "string" ? input.startTime.trim() : "";
  const endTime = typeof input.endTime === "string" ? input.endTime.trim() : "";
  if (!isIsoDate(date)) return null;
  if (!isClockTime(startTime) || !isClockTime(endTime)) return null;
  if (validateCalendarVisitWindow(startTime, endTime, workingHours)) return null;
  return { date, startTime, endTime };
}

/** First preferred slot as a confirmed calendar schedule (owner/admin intake). */
export function scheduleFromPreferredSlots(
  slots: InspectionSlot[],
): CalendarScheduleInput | null {
  const sorted = sortInspectionSlots(
    slots.filter((entry) => entry.date?.trim()),
  );
  const first = sorted[0];
  if (!first?.date?.trim()) return null;
  const startTime = first.startTime?.trim() || "08:00";
  const endTime = first.endTime?.trim() || "09:00";
  if (!isIsoDate(first.date) || !isClockTime(startTime) || !isClockTime(endTime)) {
    return null;
  }
  return { date: first.date, startTime, endTime };
}

/** Calendar slot from payload, or first preferred slot for owner-created requests. */
export function resolveOwnerCreatedSchedule(
  payload: Record<string, unknown>,
  preferredSlots: InspectionSlot[],
  workingHours: BusinessWorkingHours = DEFAULT_WORKING_HOURS,
): CalendarScheduleInput | null {
  return (
    parseCalendarScheduleInput(payload.calendarSchedule, workingHours) ??
    scheduleFromPreferredSlots(preferredSlots)
  );
}
