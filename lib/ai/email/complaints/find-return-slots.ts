import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";

import type { ReturnVisitWindow } from "./return-visit-policy";

/**
 * Finding free times for a return visit (docs/sophie-email-learning-and-auto-reply.md §10.10, "How
 * Sophie finds a free spot"). Pure: the caller reads the hours, closures, the technician's off days,
 * leave and booked times; this works out the two earliest times that fit the owner's rule.
 *
 *  1. The window comes from the rule. 2. Closures, times outside working hours and open days, and
 *  anything already booked are removed. 3. The same technician, if they work that day and aren't on
 *  leave. 4. As long as the original visit. 5. The two earliest times. The times aren't held: they're
 *  checked again when one is chosen.
 */

export type SlotInput = {
  window: ReturnVisitWindow;
  now: number;
  timeZone: string;
  /** Business working hours "08:00"–"17:00" and the open weekdays (0 = Sunday). */
  startTime: string;
  endTime: string;
  openDays: readonly number[];
  closedDates: ReadonlySet<string>;
  technician: {
    offDays: readonly string[];
    leaveDates: ReadonlySet<string>;
    /** Booked time, as moments. */
    busy: readonly { start: number; end: number }[];
  };
  /** The original visit's length; 60 when it isn't recorded. */
  durationMinutes: number | null;
  /** Times to offer. */
  limit?: number;
};

export type ReturnSlot = { date: string; startTime: string; endTime: string; start: number; end: number };

export type SlotResult = { ok: true; slots: ReturnSlot[] } | { ok: false; reason: "nothing_free" | "bad_hours" };

const DAY_MS = 24 * 60 * 60_000;
const STEP_MINUTES = 30;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** A visit can't start sooner than this after the offer is made. */
const LEAD_MS = 2 * 60 * 60_000;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const localDate = (at: number, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** The dates a rule looks at, in order. */
function candidateDates(input: SlotInput, today: string): string[] {
  const open = (date: string) => input.openDays.includes(weekday(date)) && !input.closedDates.has(date);
  const { window } = input;
  if (window.kind === "saturdays") {
    const dates: string[] = [];
    for (let offset = 0; offset < 7 * 12 && dates.length < window.count; offset++) {
      const date = addDays(today, offset);
      if (weekday(date) === 6) dates.push(date);
    }
    return dates.filter(open);
  }
  if (window.kind === "business_days") {
    const dates: string[] = [];
    for (let offset = 0; offset < 60 && dates.length < window.days; offset++) {
      const date = addDays(today, offset);
      if (open(date)) dates.push(date);
    }
    return dates;
  }
  return Array.from({ length: window.withinDays + 1 }, (_, offset) => addDays(today, offset)).filter(open);
}

export function findReturnSlots(input: SlotInput): SlotResult {
  const hoursStart = minutesOf(input.startTime);
  const hoursEnd = minutesOf(input.endTime);
  if (!(hoursStart < hoursEnd)) return { ok: false, reason: "bad_hours" };
  const duration = Math.max(15, Math.min(input.durationMinutes ?? 60, 8 * 60));
  const limit = input.limit ?? 2;
  const today = localDate(input.now, input.timeZone);
  const earliest = input.now + LEAD_MS;

  const slots: ReturnSlot[] = [];
  for (const date of candidateDates(input, today)) {
    if (input.technician.offDays.includes(WEEKDAYS[weekday(date)]) || input.technician.leaveDates.has(date)) continue;
    // The rule's own hours, kept inside the business's working hours.
    const windowStart = input.window.kind === "saturdays" ? Math.max(hoursStart, minutesOf(input.window.startTime)) : hoursStart;
    const windowEnd = input.window.kind === "saturdays" ? Math.min(hoursEnd, minutesOf(input.window.endTime)) : hoursEnd;
    for (let from = windowStart; from + duration <= windowEnd; from += STEP_MINUTES) {
      const start = zonedDateTimeToUtcMs(date, clock(from), input.timeZone);
      const end = zonedDateTimeToUtcMs(date, clock(from + duration), input.timeZone);
      if (start === null || end === null || start < earliest) continue;
      if (input.technician.busy.some((busy) => busy.start < end && busy.end > start)) continue;
      slots.push({ date, startTime: clock(from), endTime: clock(from + duration), start, end });
      // One time a day: two offers on the same day aren't a real choice.
      break;
    }
    if (slots.length >= limit) break;
  }
  return slots.length > 0 ? { ok: true, slots } : { ok: false, reason: "nothing_free" };
}
