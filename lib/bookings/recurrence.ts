import { WEEK_DAY_IDS, type WeekDayId } from "@/lib/team/staff-availability";
import {
  formatClockTime,
  formatSlotDate,
  isClockTime,
} from "@/lib/inspection/types";

export const RECURRENCE_UNITS = ["day", "week", "month"] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export const SERIES_UPDATE_MODES = [
  "this_visit",
  "this_and_future",
  "entire_series",
] as const;
export type SeriesUpdateMode = (typeof SERIES_UPDATE_MODES)[number];

export const MAX_RECURRENCE_OCCURRENCES = 52;
export const MAX_RECURRENCE_HORIZON_DAYS = 400;

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "on_date"; date: string }
  | { type: "after_count"; count: number };

export type RecurrenceTimeWindow = {
  startTime: string;
  endTime: string;
};

export type RecurrenceVisit = {
  date: string;
  startTime: string;
  endTime: string;
};

export type JobRecurrenceRule = {
  interval: number;
  unit: RecurrenceUnit;
  weekdays: WeekDayId[];
  monthDay: number | null;
  startDate: string;
  startTime: string;
  endTime: string;
  /** Weekly jobs can use a different on-site window for each selected weekday. */
  weekdayTimes: Partial<Record<WeekDayId, RecurrenceTimeWindow>>;
  end: RecurrenceEnd;
};

export const WEEKDAY_SHORT_LABELS: Record<WeekDayId, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export const WEEKDAY_LONG_LABELS: Record<WeekDayId, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function ymdFromUtcParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseYmd(
  ymd: string,
): { year: number; month: number; day: number } | null {
  if (!isIsoDate(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function utcNoon(ymd: string): Date | null {
  const parts = parseYmd(ymd);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const date = utcNoon(ymd);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return ymdFromUtcParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function addMonthsYmd(ymd: string, months: number): string | null {
  const parts = parseYmd(ymd);
  if (!parts) return null;
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return ymdFromUtcParts(year, month + 1, Math.min(parts.day, lastDay));
}

export function weekdayIdFromYmd(ymd: string): WeekDayId | null {
  const date = utcNoon(ymd);
  if (!date) return null;
  const jsDay = date.getUTCDay();
  return WEEK_DAY_IDS[jsDay === 0 ? 6 : jsDay - 1] ?? null;
}

function mondayOfWeek(ymd: string): string | null {
  const date = utcNoon(ymd);
  if (!date) return null;
  const jsDay = date.getUTCDay();
  const offset = jsDay === 0 ? -6 : 1 - jsDay;
  return addDaysYmd(ymd, offset);
}

function weeksBetweenMondays(fromYmd: string, toYmd: string): number | null {
  const fromMonday = mondayOfWeek(fromYmd);
  const toMonday = mondayOfWeek(toYmd);
  const from = fromMonday ? utcNoon(fromMonday) : null;
  const to = toMonday ? utcNoon(toMonday) : null;
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function parseEnd(raw: unknown): RecurrenceEnd | null {
  if (!raw || typeof raw !== "object") return null;
  const end = raw as Record<string, unknown>;
  const type = typeof end.type === "string" ? end.type.trim() : "";
  if (type === "never") return { type: "never" };
  if (type === "on_date") {
    const date = typeof end.date === "string" ? end.date.trim() : "";
    if (!isIsoDate(date)) return null;
    return { type: "on_date", date };
  }
  if (type === "after_count") {
    const count = Number(end.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_RECURRENCE_OCCURRENCES) {
      return null;
    }
    return { type: "after_count", count };
  }
  return null;
}

function parseWeekdays(raw: unknown): WeekDayId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<WeekDayId>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const day = item.trim().toLowerCase();
    if ((WEEK_DAY_IDS as readonly string[]).includes(day)) {
      seen.add(day as WeekDayId);
    }
  }
  return WEEK_DAY_IDS.filter((day) => seen.has(day));
}

function parseTimeWindow(raw: unknown): RecurrenceTimeWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const startTime =
    typeof record.startTime === "string" ? record.startTime.trim() : "";
  const endTime =
    typeof record.endTime === "string" ? record.endTime.trim() : "";
  if (!isClockTime(startTime) || !isClockTime(endTime) || startTime >= endTime) {
    return null;
  }
  return { startTime, endTime };
}

function parseWeekdayTimes(
  raw: unknown,
): Partial<Record<WeekDayId, RecurrenceTimeWindow>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const result: Partial<Record<WeekDayId, RecurrenceTimeWindow>> = {};
  for (const day of WEEK_DAY_IDS) {
    const window = parseTimeWindow(record[day]);
    if (window) result[day] = window;
  }
  return result;
}

export function pruneWeekdayTimes(
  weekdays: WeekDayId[],
  weekdayTimes: Partial<Record<WeekDayId, RecurrenceTimeWindow>> | undefined,
): Partial<Record<WeekDayId, RecurrenceTimeWindow>> {
  const allowed = new Set(weekdays);
  const result: Partial<Record<WeekDayId, RecurrenceTimeWindow>> = {};
  for (const day of WEEK_DAY_IDS) {
    const window = weekdayTimes?.[day];
    if (window && allowed.has(day)) result[day] = window;
  }
  return result;
}

export function firstWeekdayOnOrAfter(
  startDate: string,
  weekday: WeekDayId,
): string | null {
  let cursor: string | null = startDate;
  for (let step = 0; step < 7; step += 1) {
    if (!cursor) return null;
    if (weekdayIdFromYmd(cursor) === weekday) return cursor;
    cursor = addDaysYmd(cursor, 1);
  }
  return null;
}

export function isWeeklyRecurrence(rule: JobRecurrenceRule): boolean {
  return rule.unit === "week";
}

export function emptyRecurrenceDraft(
  startDate: string,
  startTime: string,
  endTime: string,
): JobRecurrenceRule {
  const weekday = weekdayIdFromYmd(startDate);
  const monthDay = parseYmd(startDate)?.day ?? 1;
  return {
    interval: 1,
    unit: "week",
    weekdays: weekday ? [weekday] : ["monday"],
    monthDay,
    startDate: isIsoDate(startDate) ? startDate : "",
    startTime: isClockTime(startTime) ? startTime : "09:00",
    endTime: isClockTime(endTime) ? endTime : "10:00",
    weekdayTimes: {},
    end: { type: "never" },
  };
}

export function parseJobRecurrenceRule(
  raw: unknown,
): JobRecurrenceRule | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const interval = Number(input.interval);
  const unitRaw = typeof input.unit === "string" ? input.unit.trim() : "";
  if (
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > 24 ||
    !(RECURRENCE_UNITS as readonly string[]).includes(unitRaw)
  ) {
    return null;
  }
  const unit = unitRaw as RecurrenceUnit;
  const startDate =
    typeof input.startDate === "string" ? input.startDate.trim() : "";
  const startTime =
    typeof input.startTime === "string" ? input.startTime.trim() : "";
  const endTime =
    typeof input.endTime === "string" ? input.endTime.trim() : "";
  if (!isIsoDate(startDate) || !isClockTime(startTime) || !isClockTime(endTime)) {
    return null;
  }
  if (startTime >= endTime) return null;
  const end = parseEnd(input.end);
  if (!end) return null;
  if (end.type === "on_date" && end.date < startDate) return null;

  const parsedWeekdays = parseWeekdays(input.weekdays);
  const weekdays: WeekDayId[] =
    parsedWeekdays.length > 0
      ? parsedWeekdays
      : weekdayIdFromYmd(startDate)
        ? [weekdayIdFromYmd(startDate) as WeekDayId]
        : ["monday"];
  const weekdayTimes = pruneWeekdayTimes(
    weekdays,
    parseWeekdayTimes(input.weekdayTimes),
  );
  const monthDayRaw = Number(input.monthDay);
  const startDay = parseYmd(startDate)?.day ?? 1;
  const monthDay =
    Number.isInteger(monthDayRaw) && monthDayRaw >= 1 && monthDayRaw <= 31
      ? monthDayRaw
      : startDay;

  return {
    interval,
    unit,
    weekdays,
    monthDay,
    startDate,
    startTime,
    endTime,
    weekdayTimes,
    end,
  };
}

export function parseSeriesUpdateMode(raw: unknown): SeriesUpdateMode {
  if (typeof raw !== "string") return "this_visit";
  return (SERIES_UPDATE_MODES as readonly string[]).includes(raw)
    ? (raw as SeriesUpdateMode)
    : "this_visit";
}

function maxCountForEnd(end: RecurrenceEnd): number {
  if (end.type === "after_count") return end.count;
  return MAX_RECURRENCE_OCCURRENCES;
}

function matchesWeekly(rule: JobRecurrenceRule, date: string): boolean {
  const weekday = weekdayIdFromYmd(date);
  if (!weekday || !rule.weekdays.includes(weekday)) return false;
  const weeks = weeksBetweenMondays(rule.startDate, date);
  if (weeks == null || weeks < 0) return false;
  return weeks % rule.interval === 0;
}

export function expandRecurrenceDates(rule: JobRecurrenceRule): string[] {
  const dates: string[] = [];
  const limit = maxCountForEnd(rule.end);
  const until =
    rule.end.type === "on_date"
      ? rule.end.date
      : addDaysYmd(rule.startDate, MAX_RECURRENCE_HORIZON_DAYS) ?? rule.startDate;

  if (rule.unit === "day") {
    let cursor: string | null = rule.startDate;
    while (cursor && cursor <= until && dates.length < limit) {
      dates.push(cursor);
      cursor = addDaysYmd(cursor, rule.interval);
    }
    return dates;
  }

  if (rule.unit === "month") {
    const day = rule.monthDay ?? parseYmd(rule.startDate)?.day ?? 1;
    const startParts = parseYmd(rule.startDate);
    if (!startParts) return [];
    const seed = ymdFromUtcParts(startParts.year, startParts.month, day);
    let index = 0;
    while (dates.length < limit) {
      const candidate = addMonthsYmd(seed, index * rule.interval);
      index += 1;
      if (!candidate) break;
      if (candidate < rule.startDate) continue;
      if (candidate > until) break;
      dates.push(candidate);
    }
    return dates;
  }

  let cursor: string | null = rule.startDate;
  let guard = 0;
  while (cursor && cursor <= until && dates.length < limit && guard < 800) {
    if (matchesWeekly(rule, cursor)) dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  return dates;
}

export function recurrenceWindowForDate(
  rule: JobRecurrenceRule,
  date: string,
): RecurrenceTimeWindow {
  if (rule.unit === "week") {
    const weekday = weekdayIdFromYmd(date);
    const window = weekday ? rule.weekdayTimes?.[weekday] : undefined;
    if (window) return window;
  }
  return { startTime: rule.startTime, endTime: rule.endTime };
}

export function expandRecurrenceVisits(rule: JobRecurrenceRule): RecurrenceVisit[] {
  return expandRecurrenceDates(rule).map((date) => ({
    date,
    ...recurrenceWindowForDate(rule, date),
  }));
}

export function recurrenceRulesEqual(
  a: JobRecurrenceRule | null,
  b: JobRecurrenceRule | null,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(normalizeRecurrenceForCompare(a)) ===
    JSON.stringify(normalizeRecurrenceForCompare(b));
}

function normalizeRecurrenceForCompare(rule: JobRecurrenceRule) {
  return {
    interval: rule.interval,
    unit: rule.unit,
    weekdays: [...rule.weekdays],
    monthDay: rule.monthDay,
    startDate: rule.startDate,
    startTime: rule.startTime,
    endTime: rule.endTime,
    weekdayTimes: pruneWeekdayTimes(rule.weekdays, rule.weekdayTimes),
    end: rule.end,
  };
}

function weekdayShortLabel(day: WeekDayId): string {
  return WEEKDAY_SHORT_LABELS[day];
}

function formatRuleTimeWindows(rule: JobRecurrenceRule): string {
  if (rule.unit !== "week" || rule.weekdays.length === 0) {
    return `${rule.startTime}–${rule.endTime}`;
  }

  const windows = rule.weekdays.map((day) => {
    const window = rule.weekdayTimes?.[day] ?? {
      startTime: rule.startTime,
      endTime: rule.endTime,
    };
    return { day, window };
  });
  const unique = new Set(
    windows.map((item) => `${item.window.startTime}-${item.window.endTime}`),
  );
  if (unique.size <= 1) {
    const window = windows[0]?.window;
    return window
      ? `${window.startTime}–${window.endTime}`
      : `${rule.startTime}–${rule.endTime}`;
  }

  return windows
    .map(
      (item) =>
        `${weekdayShortLabel(item.day)} ${item.window.startTime}–${item.window.endTime}`,
    )
    .join(", ");
}

export function formatRecurrenceSummary(rule: JobRecurrenceRule): string {
  const every =
    rule.interval === 1
      ? rule.unit === "day"
        ? "every day"
        : rule.unit === "week"
          ? "every week"
          : "every month"
      : `every ${rule.interval} ${rule.unit}${rule.interval === 1 ? "" : "s"}`;

  let pattern = every;
  if (rule.unit === "week") {
    const days = rule.weekdays.map(weekdayShortLabel).join(", ");
    pattern = `${every} on ${days}`;
  } else if (rule.unit === "month") {
    const day = rule.monthDay ?? parseYmd(rule.startDate)?.day ?? 1;
    pattern = `${every} on the ${day}`;
  }

  const end =
    rule.end.type === "never"
      ? "no end date"
      : rule.end.type === "on_date"
        ? `until ${rule.end.date}`
        : `for ${rule.end.count} visits`;

  return `${pattern}, ${formatRuleTimeWindows(rule)}, ${end}`;
}

function weekdayLongLabel(day: WeekDayId): string {
  return WEEKDAY_LONG_LABELS[day];
}

/** Day-of-month as an ordinal — "1st", "12th", "23rd". */
export function formatMonthDayOrdinal(day: number): string {
  const rest = day % 100;
  if (rest >= 11 && rest <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * How often the series repeats, in customer-facing words —
 * "Every week on Monday and Wednesday", "Every 2 months on the 15th".
 */
export function formatRecurrenceFrequencyLabel(rule: JobRecurrenceRule): string {
  const unitLabel =
    rule.interval === 1
      ? rule.unit
      : `${rule.interval} ${rule.unit}s`;
  const every = `Every ${unitLabel}`;

  if (rule.unit === "week" && rule.weekdays.length > 0) {
    return `${every} on ${joinWithAnd(rule.weekdays.map(weekdayLongLabel))}`;
  }
  if (rule.unit === "month") {
    const day = rule.monthDay ?? parseYmd(rule.startDate)?.day ?? 1;
    return `${every} on the ${formatMonthDayOrdinal(day)}`;
  }
  return every;
}

/**
 * The on-site window(s) in 12-hour form — a single "9 AM – 11 AM" when every
 * visit shares one window, otherwise one entry per weekday.
 */
export function formatRecurrenceTimeLabel(rule: JobRecurrenceRule): string {
  const fallback = { startTime: rule.startTime, endTime: rule.endTime };
  const label = (window: RecurrenceTimeWindow) =>
    `${formatClockTime(window.startTime) ?? window.startTime} – ${
      formatClockTime(window.endTime) ?? window.endTime
    }`;

  if (rule.unit !== "week" || rule.weekdays.length === 0) {
    return label(fallback);
  }

  const windows = rule.weekdays.map((day) => ({
    day,
    window: rule.weekdayTimes?.[day] ?? fallback,
  }));
  const unique = new Set(
    windows.map((item) => `${item.window.startTime}-${item.window.endTime}`),
  );
  if (unique.size <= 1) {
    return label(windows[0]?.window ?? fallback);
  }

  return windows
    .map((item) => `${WEEKDAY_SHORT_LABELS[item.day]} ${label(item.window)}`)
    .join(", ");
}

/** When the series stops — "Until Fri, 2 Oct 2026", "12 visits", "Ongoing". */
export function formatRecurrenceEndLabel(
  rule: JobRecurrenceRule,
  timeZone?: string | null,
): string {
  if (rule.end.type === "on_date") {
    return `Until ${formatSlotDate(rule.end.date, timeZone)}`;
  }
  if (rule.end.type === "after_count") {
    return `${rule.end.count} visit${rule.end.count === 1 ? "" : "s"}`;
  }
  return "Ongoing — no end date";
}

/**
 * One-line recurrence sentence for notification bodies and SMS, e.g.
 * "Every week on Monday and Wednesday, 9 AM – 11 AM, until Fri, 2 Oct 2026".
 */
export function formatRecurrenceSentence(
  rule: JobRecurrenceRule,
  timeZone?: string | null,
): string {
  const end =
    rule.end.type === "on_date"
      ? `until ${formatSlotDate(rule.end.date, timeZone)}`
      : rule.end.type === "after_count"
        ? `for ${rule.end.count} visit${rule.end.count === 1 ? "" : "s"}`
        : "with no end date";
  return [
    formatRecurrenceFrequencyLabel(rule),
    formatRecurrenceTimeLabel(rule),
    end,
  ].join(", ");
}

export function recurrenceFirestorePayload(rule: JobRecurrenceRule) {
  return {
    interval: rule.interval,
    unit: rule.unit,
    weekdays: rule.weekdays,
    monthDay: rule.monthDay,
    startDate: rule.startDate,
    startTime: rule.startTime,
    endTime: rule.endTime,
    weekdayTimes: pruneWeekdayTimes(rule.weekdays, rule.weekdayTimes),
    end: rule.end,
  };
}
