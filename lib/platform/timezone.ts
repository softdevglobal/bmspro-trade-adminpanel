export const PLATFORM_TIME_ZONE = "Australia/Melbourne" as const;
export const PLATFORM_TIME_ZONE_LABEL = "Melbourne (VIC) — AEST/AEDT";

export function formatInPlatformTimeZone(
  value: Date | number,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: PLATFORM_TIME_ZONE,
    ...options,
  }).format(date);
}

export function platformTodayIso(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: PLATFORM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function formatIsoDateInPlatformTimeZone(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return formatInPlatformTimeZone(
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)),
    options,
  );
}
