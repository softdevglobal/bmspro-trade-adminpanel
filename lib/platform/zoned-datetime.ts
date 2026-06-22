import { parseClockMinutes } from "@/lib/leave/clock";
import { resolvePlatformTimeZone } from "@/lib/platform/timezone";

/** Converts a calendar date + wall-clock time in a timezone to UTC epoch ms. */
export function zonedDateTimeToUtcMs(
  isoDate: string,
  clockTime: string,
  timeZone?: string | null,
): number | null {
  const [year, month, day] = isoDate.split("-").map(Number);
  const minutes = parseClockMinutes(clockTime);
  if (!year || !month || !day || minutes === null) return null;

  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const tz = resolvePlatformTimeZone(timeZone);

  let utc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utc));

    const read = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);

    const localY = read("year");
    const localM = read("month");
    const localD = read("day");
    let localH = read("hour");
    const localMin = read("minute");
    if (localH === 24) localH = 0;

    if (
      localY === year &&
      localM === month &&
      localD === day &&
      localH === hour &&
      localMin === minute
    ) {
      return utc;
    }

    const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const actual = Date.UTC(localY, localM - 1, localD, localH, localMin, 0, 0);
    utc += desired - actual;
  }

  return null;
}
