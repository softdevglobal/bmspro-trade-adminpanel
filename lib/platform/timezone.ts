export const PLATFORM_TIME_ZONE = "Australia/Melbourne" as const;
export const PLATFORM_TIME_ZONE_LABEL = "Melbourne (VIC) — AEST/AEDT";

export function resolvePlatformTimeZone(timeZone?: string | null): string {
  return typeof timeZone === "string" && timeZone.trim()
    ? timeZone.trim()
    : PLATFORM_TIME_ZONE;
}

export function formatInPlatformTimeZone(
  value: Date | number,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: resolvePlatformTimeZone(timeZone),
    ...options,
  }).format(date);
}

export function platformTodayIso(
  value = new Date(),
  timeZone?: string | null,
): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: resolvePlatformTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Minutes since midnight in the business/platform timezone (0–1439). */
export function currentClockMinutesInTimeZone(
  value = new Date(),
  timeZone?: string | null,
): number {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: resolvePlatformTimeZone(timeZone),
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(value);

  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "",
    10,
  );
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    const fallback = value instanceof Date ? value : new Date(value);
    return fallback.getHours() * 60 + fallback.getMinutes();
  }
  return hour * 60 + minute;
}

export function isIsoDateBeforeToday(
  iso: string,
  timeZone?: string | null,
  now = new Date(),
): boolean {
  return iso < platformTodayIso(now, timeZone);
}

export function formatIsoDateInPlatformTimeZone(
  iso: string,
  options: Intl.DateTimeFormatOptions,
  timeZone?: string | null,
): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return formatInPlatformTimeZone(
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)),
    options,
    timeZone,
  );
}
