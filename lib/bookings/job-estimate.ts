import { isClockTime } from "@/lib/inspection/types";

export const JOB_ESTIMATE_PRESETS = [60, 90, 120, 180, 240, 360] as const;

export const JOB_ESTIMATE_SELECT_CLASS =
  "mt-1 w-full appearance-none rounded-lg border border-outline-variant/60 bg-white bg-[length:0.875rem] bg-[right_1.1rem_center] bg-no-repeat py-2 pl-2.5 pr-9 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60";

export const JOB_ESTIMATE_SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E\")";

function minutesFromMidnight(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes between two clock times (end must be after start). */
export function minutesBetweenClockTimes(
  start: string,
  end: string,
): number | null {
  if (!isClockTime(start) || !isClockTime(end)) return null;
  const diff = minutesFromMidnight(end) - minutesFromMidnight(start);
  return diff > 0 ? diff : null;
}

export function formatJobEstimateLabel(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  if (mins === 60) return "1 hour";
  if (mins % 60 === 0) return `${mins / 60} hours`;
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
}

/** Preset options plus the current selection when it is not a preset. */
export function jobEstimateOptionValues(selectedMinutes: number): number[] {
  const values = new Set<number>(JOB_ESTIMATE_PRESETS);
  if (selectedMinutes >= 15 && selectedMinutes <= 24 * 60) {
    values.add(selectedMinutes);
  }
  return [...values].sort((a, b) => a - b);
}

export function estimateMinutesFromTimeRange(
  start: string,
  end: string,
  fallback = 120,
): number {
  return minutesBetweenClockTimes(start, end) ?? fallback;
}
