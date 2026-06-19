"use client";

import {
  CALENDAR_SLOT_END_HOUR,
  CALENDAR_SLOT_START_HOUR,
} from "@/lib/calendar/time-slots";
import { validateCalendarVisitWindow } from "@/lib/calendar/visit-window";
import { parseClockMinutes } from "@/lib/leave/clock";
import {
  formatClockTime,
  isClockTime,
  timeRangeFromStartTime,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { useEffect, useMemo } from "react";

export { validateCalendarVisitWindow };

const CALENDAR_VISIT_STEP_MINUTES = 60;

function minutesFromMidnight(clock: string): number {
  if (!isClockTime(clock)) return 0;
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

export function calendarVisitTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (
    let hour = CALENDAR_SLOT_START_HOUR;
    hour <= CALENDAR_SLOT_END_HOUR;
    hour += 1
  ) {
    const value = `${String(hour).padStart(2, "0")}:00`;
    const label = formatClockTime(value);
    if (label) options.push({ value, label });
  }
  return options;
}

export function defaultCalendarVisitEnd(startTime: string): string {
  const startMin = parseClockMinutes(startTime);
  if (startMin == null) return "09:00";
  const next = Math.min(
    startMin + CALENDAR_VISIT_STEP_MINUTES,
    CALENDAR_SLOT_END_HOUR * 60,
  );
  const hour = Math.floor(next / 60);
  return `${String(hour).padStart(2, "0")}:00`;
}

export function calendarVisitTimeRange(
  startTime: string,
): InspectionTimeRange {
  return timeRangeFromStartTime(startTime);
}

const SELECT_CLASS =
  "w-full appearance-none rounded-lg border border-outline-variant/60 bg-white bg-[length:0.875rem] bg-[right_1.1rem_center] bg-no-repeat py-2.5 pl-3 pr-9 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60";
const CHEVRON_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E\")";

export function CalendarVisitTimeRangeFields({
  startTime,
  endTime,
  disabled = false,
  onStartTimeChange,
  onEndTimeChange,
}: {
  startTime: string;
  endTime: string;
  disabled?: boolean;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
}) {
  const options = useMemo(() => calendarVisitTimeOptions(), []);
  const startValid = isClockTime(startTime);

  const endOptions = useMemo(() => {
    if (!startValid) return options.slice(1);
    const minEnd = minutesFromMidnight(startTime) + CALENDAR_VISIT_STEP_MINUTES;
    return options.filter((opt) => minutesFromMidnight(opt.value) >= minEnd);
  }, [options, startTime, startValid]);

  useEffect(() => {
    if (!startValid || !isClockTime(endTime)) return;
    if (minutesFromMidnight(startTime) >= minutesFromMidnight(endTime)) {
      const next = endOptions[0]?.value;
      if (next) onEndTimeChange(next);
    }
  }, [startTime, endTime, startValid, endOptions, onEndTimeChange]);

  return (
    <div className="space-y-2">
      <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
        Time range
      </span>
      <div className="flex items-center gap-2">
        <select
          value={startTime}
          disabled={disabled}
          aria-label="Visit start time"
          onChange={(event) => onStartTimeChange(event.target.value)}
          className={SELECT_CLASS}
          style={{ backgroundImage: CHEVRON_BG }}
        >
          {options.slice(0, -1).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="shrink-0 font-body text-[13px] text-on-surface-variant">
          to
        </span>
        <select
          value={endTime}
          disabled={disabled || endOptions.length === 0}
          aria-label="Visit end time"
          onChange={(event) => onEndTimeChange(event.target.value)}
          className={SELECT_CLASS}
          style={{ backgroundImage: CHEVRON_BG }}
        >
          {endOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <p className="font-body text-[12px] text-on-surface-variant">
        Calendar slots between these times will be filled automatically.
      </p>
    </div>
  );
}
