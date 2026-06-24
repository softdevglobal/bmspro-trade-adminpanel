import { formatClockTime, isClockTime } from "@/lib/inspection/types";
import { parseClockMinutes } from "@/lib/leave/clock";

export type BusinessWorkingHours = {
  startTime: string;
  endTime: string;
};

export type CalendarSlotBounds = {
  startHour: number;
  endHour: number;
};

/** Default calendar window: 8:00 AM – 5:00 PM (matches legacy behaviour). */
export const DEFAULT_WORKING_HOURS: BusinessWorkingHours = {
  startTime: "08:00",
  endTime: "17:00",
};

function normaliseClockTime(value: string): string | null {
  if (!isClockTime(value)) return null;
  const trimmed = value.trim();
  const [hourPart, minutePart] = trimmed.split(":");
  const hour = Number.parseInt(hourPart ?? "", 10);
  const minute = Number.parseInt(minutePart ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function workingHoursToSlotBounds(
  hours: BusinessWorkingHours,
): CalendarSlotBounds {
  const startMin =
    parseClockMinutes(hours.startTime) ??
    parseClockMinutes(DEFAULT_WORKING_HOURS.startTime)!;
  const endMin =
    parseClockMinutes(hours.endTime) ??
    parseClockMinutes(DEFAULT_WORKING_HOURS.endTime)!;
  return {
    startHour: Math.floor(startMin / 60),
    endHour: Math.ceil(endMin / 60),
  };
}

export function resolveCalendarSlotBounds(
  workingHours?: BusinessWorkingHours | null,
): CalendarSlotBounds {
  return workingHoursToSlotBounds(workingHours ?? DEFAULT_WORKING_HOURS);
}

export function parseWorkingHoursFromBusiness(
  data: Record<string, unknown> | null | undefined,
): BusinessWorkingHours {
  const nested = data?.workingHours;
  if (nested && typeof nested === "object") {
    const record = nested as Record<string, unknown>;
    const startTime = normaliseClockTime(
      typeof record.startTime === "string" ? record.startTime : "",
    );
    const endTime = normaliseClockTime(
      typeof record.endTime === "string" ? record.endTime : "",
    );
    if (startTime && endTime) {
      const validated = validateWorkingHours({ startTime, endTime });
      if (validated.ok) return validated.value;
    }
  }

  return DEFAULT_WORKING_HOURS;
}

export function validateWorkingHours(
  hours: BusinessWorkingHours,
): { ok: true; value: BusinessWorkingHours } | { ok: false; error: string } {
  const startTime = normaliseClockTime(hours.startTime);
  const endTime = normaliseClockTime(hours.endTime);

  if (!startTime || !endTime) {
    return { ok: false, error: "Enter valid start and end times." };
  }

  const startMin = parseClockMinutes(startTime);
  const endMin = parseClockMinutes(endTime);
  if (startMin == null || endMin == null) {
    return { ok: false, error: "Enter valid start and end times." };
  }

  if (endMin <= startMin) {
    return { ok: false, error: "End time must be after the start time." };
  }

  return { ok: true, value: { startTime, endTime } };
}

export function parseWorkingHoursInput(
  rawStart: unknown,
  rawEnd: unknown,
): { ok: true; value: BusinessWorkingHours } | { ok: false; error: string } {
  if (typeof rawStart !== "string" || typeof rawEnd !== "string") {
    return { ok: false, error: "Enter a start and end time." };
  }
  return validateWorkingHours({
    startTime: rawStart.trim(),
    endTime: rawEnd.trim(),
  });
}

export function describeWorkingHoursWindow(hours: BusinessWorkingHours): string {
  const start = formatClockTime(hours.startTime);
  const end = formatClockTime(hours.endTime);
  if (start && end) return `${start} – ${end}`;
  return `${hours.startTime} – ${hours.endTime}`;
}
