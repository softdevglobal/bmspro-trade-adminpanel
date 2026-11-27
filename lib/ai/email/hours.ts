/**
 * "Are you open today?" (docs/sophie-email-learning-and-auto-reply.md §8.6). Pure: the caller reads
 * the business's hours, open days and closed dates, and this works out the answer.
 *
 * - "Today" is the day the email was SENT, in the business time zone.
 * - The answer always names the weekday and date ("Wednesday 26 November"), never just "today".
 * - A closure's reason is never used: it may be private.
 * - Anything unclear (no day named, two different days, hours or open days not set) is left to the
 *   owner. Sophie never guesses.
 */

export type HoursAsk =
  | { kind: "today" }
  | { kind: "tomorrow" }
  /** 0 = Sunday to 6 = Saturday: the next one on or after the day the email was sent. */
  | { kind: "weekday"; day: number };

export type HoursSetup = {
  /** "08:00". Null when the owner never saved working hours. */
  startTime: string | null;
  endTime: string | null;
  /** Null until the owner sets them. */
  openDays: number[] | null;
  /** YYYY-MM-DD dates the business is closed. */
  closedDates: ReadonlySet<string>;
};

export type HoursAnswer = {
  template: "hours_open" | "hours_closed_day" | "hours_after_close";
  /** "today, Wednesday 26 November", or "Saturday 29 November". */
  dayLabel: string;
  /** "8 am", "5 pm". For hours_open. */
  start: string | null;
  end: string | null;
  /** The next open day after a closed or finished one. */
  next: { dayLabel: string; start: string; end: string } | null;
  /** hours_after_close: the email came in after closing (rather than the day having passed since). */
  closedWhenSent: boolean;
};

export type HoursResult = { ok: true; answer: HoursAnswer } | { ok: false; reason: "not_set" | "unclear" | "no_open_day" };

/** Full names, and short forms that aren't ordinary words ("sat" and "sun" are). */
const DAY_WORDS: [RegExp, number][] = [
  [/\bsundays?\b/i, 0],
  [/\b(mondays?|mon)\b/i, 1],
  [/\b(tuesdays?|tues?)\b/i, 2],
  [/\b(wednesdays?|wed)\b/i, 3],
  [/\b(thursdays?|thu|thur|thurs)\b/i, 4],
  [/\b(fridays?|fri)\b/i, 5],
  [/\bsaturdays?\b/i, 6],
];
const DAY_MS = 24 * 60 * 60_000;

/** The day an "are you open" email asks about, or null when it isn't clear. */
export function askedDay(text: string): HoursAsk | null {
  const found: HoursAsk[] = [];
  if (/\b(today|tonight|this (?:morning|afternoon|arvo|evening))\b/i.test(text)) found.push({ kind: "today" });
  if (/\btomorrow\b/i.test(text)) found.push({ kind: "tomorrow" });
  for (const [pattern, day] of DAY_WORDS) if (pattern.test(text)) found.push({ kind: "weekday", day });
  const unique = new Map(found.map((ask) => [ask.kind === "weekday" ? `w${ask.day}` : ask.kind, ask]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function localParts(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(at));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

/** Calendar arithmetic on YYYY-MM-DD, independent of time zones. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${date}T00:00:00Z`));
}

/** "08:00" → "8 am", "13:30" → "1:30 pm". */
export function clockLabel(clock: string): string {
  const [hour, minute] = clock.split(":").map(Number);
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${twelve}:${String(minute).padStart(2, "0")} ${suffix}` : `${twelve} ${suffix}`;
}

const toMinutes = (clock: string) => {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
};

export function hoursAnswer(input: { ask: HoursAsk | null; sentAt: number; now: number; timeZone: string; setup: HoursSetup }): HoursResult {
  const { setup } = input;
  if (!setup.startTime || !setup.endTime || !setup.openDays || setup.openDays.length === 0) return { ok: false, reason: "not_set" };
  if (!input.ask) return { ok: false, reason: "unclear" };
  let sent: ReturnType<typeof localParts>;
  let today: string;
  try {
    sent = localParts(input.sentAt, input.timeZone);
    today = localParts(input.now, input.timeZone).date;
  } catch {
    return { ok: false, reason: "unclear" };
  }

  const asked = input.ask.kind === "today" ? sent.date
    : input.ask.kind === "tomorrow" ? addDays(sent.date, 1)
      : addDays(sent.date, (input.ask.day - weekdayOf(sent.date) + 7) % 7);
  const openOn = (date: string) => setup.openDays!.includes(weekdayOf(date)) && !setup.closedDates.has(date);
  const relative = (date: string) => (date === today ? "today, " : date === addDays(today, 1) ? "tomorrow, " : "");
  const label = (date: string) => `${relative(date)}${dateLabel(date)}`;
  const hours = { start: clockLabel(setup.startTime), end: clockLabel(setup.endTime) };
  const nextOpenFrom = (date: string) => {
    for (let offset = 0; offset < 14; offset++) {
      const day = addDays(date, offset);
      if (openOn(day)) return { dayLabel: label(day), ...hours };
    }
    return null;
  };

  // Closed that date, or not an open weekday: say so, and when we're open next.
  if (!openOn(asked)) {
    const next = nextOpenFrom(addDays(asked < today ? today : asked, asked < today ? 0 : 1));
    if (!next) return { ok: false, reason: "no_open_day" };
    return { ok: true, answer: { template: "hours_closed_day", dayLabel: label(asked), start: null, end: null, next, closedWhenSent: false } };
  }
  const closedWhenSent = asked === sent.date && sent.minutes >= toMinutes(setup.endTime);
  // That day is over: when the email came in, or by the time Sophie answers.
  if (closedWhenSent || asked < today) {
    const next = nextOpenFrom(asked < today ? today : addDays(asked, 1));
    if (!next) return { ok: false, reason: "no_open_day" };
    return { ok: true, answer: { template: "hours_after_close", dayLabel: label(asked), start: null, end: null, next, closedWhenSent } };
  }
  return { ok: true, answer: { template: "hours_open", dayLabel: label(asked), start: hours.start, end: hours.end, next: null, closedWhenSent: false } };
}

/** More than the hours is asked: then a template can't answer it all, and the owner decides (§8.6). */
export function asksMoreThanHours(text: string): boolean {
  const questions = text.split(/(?<=\?)/).filter((part) => part.includes("?"));
  return questions.some((question) => !/\b(open|close|closed|closing|hours|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|holiday)\b/i.test(question));
}
