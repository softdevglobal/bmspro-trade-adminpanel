/**
 * Reads a date written in an email ("due 3 Dec", "3 December 2026", "03/12/2026", "2026-12-03")
 * into YYYY-MM-DD, for bills and calendar reminders. Pure. Day-first, as Australians write dates.
 * Anything unclear returns null, and the owner is asked for the date instead of Sophie guessing.
 */

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** A month written in full or cut short ("dec", "sept"), but not a word that only starts like one ("decent"). */
function monthOf(word: string): number | null {
  if (word.length < 3) return null;
  const index = MONTH_NAMES.findIndex((name) => name.startsWith(word));
  return index >= 0 ? index + 1 : null;
}

const iso = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function valid(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localToday(referenceMs: number, timeZone: string): { year: number; key: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(referenceMs));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(read("year")), key: `${read("year")}-${read("month")}-${read("day")}` };
}

/**
 * With no year written, the date is this year's, unless that was more than 60 days ago: then next
 * year's ("due 5 Jan" in a December email means January next year).
 */
export function parseWrittenDate(text: string | null | undefined, referenceMs: number, timeZone: string): string | null {
  if (!text) return null;
  const value = text.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const today = localToday(referenceMs, timeZone);
  const withYear = (year: number | null, month: number, day: number): string | null => {
    if (year !== null) {
      const full = year < 100 ? 2000 + year : year;
      return valid(full, month, day) ? iso(full, month, day) : null;
    }
    if (!valid(today.year, month, day) && !valid(today.year + 1, month, day)) return null;
    const thisYear = valid(today.year, month, day) ? iso(today.year, month, day) : null;
    const sixtyDaysAgo = new Date(referenceMs - 60 * 86_400_000).toISOString().slice(0, 10);
    return thisYear && thisYear >= sixtyDaysAgo ? thisYear : iso(today.year + 1, month, day);
  };

  let match = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(value);
  if (match) return withYear(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(value);
  if (match) return withYear(match[3] ? Number(match[3]) : null, Number(match[2]), Number(match[1]));
  // "3 Dec 2026", then "Dec 3 2026". Every match is tried: "12 items due 3 Dec" is 3 Dec.
  for (const found of value.matchAll(/\b(\d{1,2}) ([a-z]{3,9})(?: (\d{4}))?\b/g)) {
    const month = monthOf(found[2]);
    if (month) return withYear(found[3] ? Number(found[3]) : null, month, Number(found[1]));
  }
  for (const found of value.matchAll(/\b([a-z]{3,9}) (\d{1,2})(?: (\d{4}))?\b/g)) {
    const month = monthOf(found[1]);
    if (month) return withYear(found[3] ? Number(found[3]) : null, month, Number(found[2]));
  }
  return null;
}

/** YYYY-MM-DD minus whole days. */
export function daysBefore(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}
