import type { CalendarEvent } from "@/lib/calendar/events";
import {
  DEFAULT_WORKING_HOURS,
  resolveCalendarSlotBounds,
  type BusinessWorkingHours,
  type CalendarSlotBounds,
} from "@/lib/calendar/working-hours";
import { parseClockMinutes } from "@/lib/leave/clock";
import {
  formatClockTime,
  isClockTime,
  timeRangeFromStartTime,
  type InspectionTimeRange,
} from "@/lib/inspection/types";

const defaultBounds = resolveCalendarSlotBounds();

/** First slot starts at 8:00; last slot is 16:00–17:00 (default working hours). */
export const CALENDAR_SLOT_START_HOUR = defaultBounds.startHour;
export const CALENDAR_SLOT_END_HOUR = defaultBounds.endHour;

export type CalendarTimeSlot = {
  startTime: string;
  endTime: string;
  session: InspectionTimeRange;
};

export type CalendarSlotSelection = {
  date: string;
  startTime: string;
  endTime: string;
  timeRange: InspectionTimeRange;
};

export const CALENDAR_SESSION_META: Record<
  InspectionTimeRange,
  { label: string; hint: string; icon: string }
> = {
  morning: { label: "Morning", hint: "8am – 12pm", icon: "wb_twilight" },
  afternoon: { label: "Afternoon", hint: "12pm – 5pm", icon: "wb_sunny" },
};

const DEFAULT_EVENT_WINDOW: Record<
  InspectionTimeRange,
  { startTime: string; endTime: string }
> = {
  morning: { startTime: "10:00", endTime: "11:00" },
  afternoon: { startTime: "13:00", endTime: "14:00" },
};

export function calendarSessionMeta(
  workingHours: BusinessWorkingHours = DEFAULT_WORKING_HOURS,
): Record<InspectionTimeRange, { label: string; hint: string; icon: string }> {
  const bounds = resolveCalendarSlotBounds(workingHours);
  const noonMin = 12 * 60;
  const startMin = bounds.startHour * 60;
  const endMin = bounds.endHour * 60;
  const morningEndMin = Math.min(noonMin, endMin);
  const afternoonStartMin = Math.max(noonMin, startMin);

  const morningHint =
    morningEndMin > startMin
      ? `${formatClockTime(workingHours.startTime) ?? workingHours.startTime} – ${formatClockTime(`${String(Math.floor(morningEndMin / 60)).padStart(2, "0")}:00`) ?? ""}`
      : "—";
  const afternoonHint =
    endMin > afternoonStartMin
      ? `${formatClockTime(`${String(Math.floor(afternoonStartMin / 60)).padStart(2, "0")}:00`) ?? ""} – ${formatClockTime(workingHours.endTime) ?? workingHours.endTime}`
      : "—";

  return {
    morning: { label: "Morning", hint: morningHint, icon: "wb_twilight" },
    afternoon: { label: "Afternoon", hint: afternoonHint, icon: "wb_sunny" },
  };
}

/** Hourly slots across the business working window (each 1 hour). */
export function generateCalendarHourSlots(
  workingHours?: BusinessWorkingHours | null,
): CalendarTimeSlot[] {
  const { startHour, endHour } = resolveCalendarSlotBounds(workingHours);
  const slots: CalendarTimeSlot[] = [];
  for (let hour = startHour; hour < endHour; hour += 1) {
    slots.push({
      startTime: `${String(hour).padStart(2, "0")}:00`,
      endTime: `${String(hour + 1).padStart(2, "0")}:00`,
      session: hour < 12 ? "morning" : "afternoon",
    });
  }
  return slots;
}

export function hourBucketForClockTime(
  clock: string,
  workingHours?: BusinessWorkingHours | null,
): string | null {
  const { startHour, endHour } = resolveCalendarSlotBounds(workingHours);
  if (!isClockTime(clock)) return null;
  const hour = Number.parseInt(clock.split(":")[0] ?? "", 10);
  if (!Number.isFinite(hour)) return null;
  if (hour < startHour) {
    return `${String(startHour).padStart(2, "0")}:00`;
  }
  if (hour >= endHour) {
    return `${String(endHour - 1).padStart(2, "0")}:00`;
  }
  return `${String(hour).padStart(2, "0")}:00`;
}

export function defaultHourForTimeRange(
  timeRange: InspectionTimeRange,
  workingHours?: BusinessWorkingHours | null,
): string {
  const defaults = DEFAULT_EVENT_WINDOW[timeRange];
  const bucket = hourBucketForClockTime(defaults.startTime, workingHours);
  return bucket ?? defaults.startTime;
}

function calendarSlotBoundsMinutes(
  workingHours?: BusinessWorkingHours | null,
): { startMin: number; endMin: number } {
  const { startHour, endHour } = resolveCalendarSlotBounds(workingHours);
  return {
    startMin: startHour * 60,
    endMin: endHour * 60,
  };
}

/** Resolve the visit window in minutes for placement on the day grid. */
export function calendarEventWindowMinutes(
  event: CalendarEvent,
  workingHours?: BusinessWorkingHours | null,
): {
  startMin: number;
  endMin: number;
} | null {
  if (event.personalEvent) {
    const personal = event.personalEvent;
    if (personal.date !== event.date) return null;
    const startMin = parseClockMinutes(personal.startTime);
    const endMin = parseClockMinutes(personal.endTime);
    if (startMin == null || endMin == null || endMin <= startMin) return null;
    return { startMin, endMin };
  }

  const record = event.booking ?? event.request;
  if (!record) return null;

  const slot = record.scheduledSlot;
  if (!slot || slot.date !== event.date) return null;

  const { startMin: gridStart, endMin: gridEnd } =
    calendarSlotBoundsMinutes(workingHours);

  let startMin = parseClockMinutes(record.scheduledStartTime);
  let endMin = parseClockMinutes(record.scheduledEndTime);

  if (startMin == null && endMin == null) {
    const defaults = DEFAULT_EVENT_WINDOW[slot.timeRange];
    startMin = parseClockMinutes(defaults.startTime);
    endMin = parseClockMinutes(defaults.endTime);
  } else if (startMin != null && endMin == null) {
    endMin = startMin + 60;
  } else if (startMin == null && endMin != null) {
    startMin = endMin - 60;
  }

  if (startMin == null || endMin == null) return null;
  if (endMin <= startMin) endMin = startMin + 60;

  startMin = Math.max(startMin, gridStart);
  endMin = Math.min(endMin, gridEnd);
  if (endMin <= startMin) return null;

  return { startMin, endMin };
}

function hourSlotStartTimes(bounds: CalendarSlotBounds): string[] {
  return Array.from(
    { length: bounds.endHour - bounds.startHour },
    (_, index) =>
      `${String(bounds.startHour + index).padStart(2, "0")}:00`,
  );
}

/** All hourly rows an event occupies based on its scheduled start/end. */
export function calendarEventHourSlots(
  event: CalendarEvent,
  workingHours?: BusinessWorkingHours | null,
): string[] {
  const window = calendarEventWindowMinutes(event, workingHours);
  if (!window) return [];

  const bounds = resolveCalendarSlotBounds(workingHours);
  const matched: string[] = [];
  for (const startTime of hourSlotStartTimes(bounds)) {
    const slotStart = parseClockMinutes(startTime);
    if (slotStart == null) continue;
    const slotEnd = slotStart + 60;
    if (slotStart < window.endMin && slotEnd > window.startMin) {
      matched.push(startTime);
    }
  }
  return matched;
}

/** First occupied hour row (legacy helper). */
export function calendarEventHourSlot(
  event: CalendarEvent,
  workingHours?: BusinessWorkingHours | null,
): string | null {
  return calendarEventHourSlots(event, workingHours)[0] ?? null;
}

export function groupEventsByDateAndHourSlot(
  events: CalendarEvent[],
  workingHours?: BusinessWorkingHours | null,
): Record<string, Partial<Record<string, CalendarEvent[]>>> {
  const grouped: Record<string, Partial<Record<string, CalendarEvent[]>>> =
    {};

  for (const event of events) {
    for (const hour of calendarEventHourSlots(event, workingHours)) {
      if (!grouped[event.date]) grouped[event.date] = {};
      const bucket = grouped[event.date]![hour] ?? [];
      bucket.push(event);
      grouped[event.date]![hour] = bucket;
    }
  }

  return grouped;
}

export function calendarSlotSelection(
  date: string,
  slot: CalendarTimeSlot,
): CalendarSlotSelection {
  return {
    date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    timeRange: timeRangeFromStartTime(slot.startTime),
  };
}

export type CalendarHourSlotPlacement = {
  event: CalendarEvent;
  /** True when this row is not the first hour of a multi-hour visit. */
  continued: boolean;
};

export function calendarEventPlacementsForDay(
  events: CalendarEvent[],
  workingHours?: BusinessWorkingHours | null,
): Partial<Record<string, CalendarHourSlotPlacement[]>> {
  const map: Partial<Record<string, CalendarHourSlotPlacement[]>> = {};

  for (const event of events) {
    const hours = calendarEventHourSlots(event, workingHours);
    hours.forEach((hour, index) => {
      if (!map[hour]) map[hour] = [];
      map[hour]!.push({ event, continued: index > 0 });
    });
  }

  return map;
}
