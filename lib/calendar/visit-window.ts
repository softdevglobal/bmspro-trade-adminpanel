import { parseClockMinutes } from "@/lib/leave/clock";
import {
  DEFAULT_WORKING_HOURS,
  describeWorkingHoursWindow,
  type BusinessWorkingHours,
} from "@/lib/calendar/working-hours";
import { isClockTime } from "@/lib/inspection/types";

export function validateCalendarVisitWindow(
  startTime: string,
  endTime: string,
  workingHours: BusinessWorkingHours = DEFAULT_WORKING_HOURS,
): string | null {
  if (!isClockTime(startTime) || !isClockTime(endTime)) {
    return "Choose a valid start and end time.";
  }
  const startMin = parseClockMinutes(startTime);
  const endMin = parseClockMinutes(endTime);
  const windowStartMin = parseClockMinutes(workingHours.startTime);
  const windowEndMin = parseClockMinutes(workingHours.endTime);
  if (
    startMin == null ||
    endMin == null ||
    windowStartMin == null ||
    windowEndMin == null
  ) {
    return "Choose a valid start and end time.";
  }
  if (startMin < windowStartMin) {
    return `Start time must be ${describeWorkingHoursWindow(workingHours).split(" – ")[0]} or later.`;
  }
  if (endMin > windowEndMin) {
    return `End time must be ${describeWorkingHoursWindow(workingHours).split(" – ")[1]} or earlier.`;
  }
  if (endMin <= startMin) {
    return "End time must be after the start time.";
  }
  return null;
}
