import { parseClockMinutes } from "@/lib/leave/clock";
import {
  CALENDAR_SLOT_END_HOUR,
  CALENDAR_SLOT_START_HOUR,
} from "@/lib/calendar/time-slots";
import { isClockTime } from "@/lib/inspection/types";

export function validateCalendarVisitWindow(
  startTime: string,
  endTime: string,
): string | null {
  if (!isClockTime(startTime) || !isClockTime(endTime)) {
    return "Choose a valid start and end time.";
  }
  const startMin = parseClockMinutes(startTime);
  const endMin = parseClockMinutes(endTime);
  if (startMin == null || endMin == null) {
    return "Choose a valid start and end time.";
  }
  if (startMin < CALENDAR_SLOT_START_HOUR * 60) {
    return "Start time must be 8:00 AM or later.";
  }
  if (endMin > CALENDAR_SLOT_END_HOUR * 60) {
    return "End time must be 5:00 PM or earlier.";
  }
  if (endMin <= startMin) {
    return "End time must be after the start time.";
  }
  return null;
}
