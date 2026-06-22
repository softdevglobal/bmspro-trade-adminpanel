import { isClockTime } from "@/lib/inspection/types";
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
): CalendarScheduleInput | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const startTime =
    typeof input.startTime === "string" ? input.startTime.trim() : "";
  const endTime = typeof input.endTime === "string" ? input.endTime.trim() : "";
  if (!isIsoDate(date)) return null;
  if (!isClockTime(startTime) || !isClockTime(endTime)) return null;
  if (validateCalendarVisitWindow(startTime, endTime)) return null;
  return { date, startTime, endTime };
}
