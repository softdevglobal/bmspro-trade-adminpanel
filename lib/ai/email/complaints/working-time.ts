import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";

/**
 * A technician's working time (docs/sophie-email-learning-and-auto-reply.md §10.4 step 6). Sophie
 * asks a technician only during their working hours, never on an off day or approved leave (playbook
 * S01: no after-hours personal contact), and the 4-hour answer time counts working hours only.
 * Pure: the caller gives the hours, the off days and the leave dates.
 */

export type WorkingSchedule = {
  /** "08:00" */
  startTime: string;
  endTime: string;
  /** Weekday names as stored: "monday" … */
  offDays: readonly string[];
  /** YYYY-MM-DD dates of approved full-day leave. */
  leaveDates: ReadonlySet<string>;
  timeZone: string;
};

const DAY_MS = 24 * 60 * 60_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Looking further ahead than this means nobody works: give up and let the owner decide. */
const MAX_DAYS_AHEAD = 21;

const localDate = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const worksOn = (date: string, schedule: WorkingSchedule) =>
  !schedule.offDays.includes(WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]) && !schedule.leaveDates.has(date);

/** The working window on one date, as moments. Null on an off day or leave, or if the hours are unusable. */
function windowOn(date: string, schedule: WorkingSchedule): { start: number; end: number } | null {
  if (!worksOn(date, schedule)) return null;
  const start = zonedDateTimeToUtcMs(date, schedule.startTime, schedule.timeZone);
  const end = zonedDateTimeToUtcMs(date, schedule.endTime, schedule.timeZone);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

/** Now if it's inside working time, otherwise when it next starts. Null when nobody works in the next 3 weeks. */
export function nextWorkingMoment(now: number, schedule: WorkingSchedule): number | null {
  const today = localDate(now, schedule.timeZone);
  for (let offset = 0; offset <= MAX_DAYS_AHEAD; offset++) {
    const window = windowOn(addDays(today, offset), schedule);
    if (!window || window.end <= now) continue;
    return Math.max(window.start, now);
  }
  return null;
}

/** The moment `minutes` of working time after `from`. Null when it can't be worked out. */
export function addWorkingMinutes(from: number, minutes: number, schedule: WorkingSchedule): number | null {
  let at = nextWorkingMoment(from, schedule);
  let left = minutes;
  for (let guard = 0; at !== null && guard < MAX_DAYS_AHEAD * 2; guard++) {
    const window = windowOn(localDate(at, schedule.timeZone), schedule);
    if (!window) return null;
    const room = (window.end - at) / 60_000;
    if (left <= room) return at + left * 60_000;
    left -= room;
    at = nextWorkingMoment(window.end + 1, schedule);
  }
  return null;
}
