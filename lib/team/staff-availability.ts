import { resolvePlatformTimeZone } from "@/lib/platform/timezone";

export const WEEK_DAY_IDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type WeekDayId = (typeof WEEK_DAY_IDS)[number];

const WEEK_DAY_SET = new Set<string>(WEEK_DAY_IDS);

export type StaffDayAvailability = {
  day: WeekDayId;
  isOff: boolean;
  serviceAreas: string[];
};

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Normalize stored or submitted availability to all seven weekdays. */
export function normalizeStaffDayAvailability(
  value: unknown,
  allowedServiceAreas: string[] = [],
): StaffDayAvailability[] {
  const parsed = new Map<WeekDayId, StaffDayAvailability>();

  if (Array.isArray(value) && value.some((item) => typeof item === "object")) {
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const day =
        typeof record.day === "string" ? record.day.trim().toLowerCase() : "";
      if (!WEEK_DAY_SET.has(day)) continue;

      parsed.set(day as WeekDayId, {
        day: day as WeekDayId,
        isOff: record.isOff === true,
        serviceAreas: [],
      });
    }
  } else {
    const legacy = sanitizeStringArray(value);
    for (const day of WEEK_DAY_IDS) {
      const isWeekday = day !== "saturday" && day !== "sunday";
      const available =
        (isWeekday && legacy.includes("Weekdays")) ||
        (day === "saturday" && legacy.includes("Saturdays")) ||
        (day === "sunday" && legacy.includes("Sundays"));
      parsed.set(day, {
        day,
        isOff: !available,
        serviceAreas: [],
      });
    }
  }

  return WEEK_DAY_IDS.map(
    (day) =>
      parsed.get(day) ?? {
        day,
        isOff: false,
        serviceAreas: [],
      },
  );
}

export function weekDayIdFromYmd(
  ymd: string,
  timeZone?: string | null,
): WeekDayId | null {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return null;

  const weekday = new Intl.DateTimeFormat("en-AU", {
    timeZone: resolvePlatformTimeZone(timeZone),
    weekday: "long",
  })
    .format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)))
    .toLowerCase();

  return WEEK_DAY_SET.has(weekday) ? (weekday as WeekDayId) : null;
}

/** Weekday ids marked as off in stored staff availability. */
export function offDayIdsFromAvailability(value: unknown): WeekDayId[] {
  return normalizeStaffDayAvailability(value)
    .filter((day) => day.isOff)
    .map((day) => day.day);
}

export function isStaffOffOnDate(
  offDays: readonly string[],
  ymd: string,
  timeZone?: string | null,
): boolean {
  const weekDay = weekDayIdFromYmd(ymd, timeZone);
  if (!weekDay) return false;
  return offDays.includes(weekDay);
}

export function staffOffDayBlockLabel(weekDay: WeekDayId): string {
  const label = weekDay.charAt(0).toUpperCase() + weekDay.slice(1);
  return `Off day (${label})`;
}

export function buildStaffOffDayBlockMap(
  staff: { id: string; offDays?: readonly string[] }[],
  staffIds: string[],
  ymd: string | null | undefined,
  timeZone?: string | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!ymd) return map;

  const weekDay = weekDayIdFromYmd(ymd, timeZone);
  if (!weekDay) return map;

  const byId = new Map(staff.map((member) => [member.id, member]));
  for (const id of staffIds) {
    const member = byId.get(id);
    const offDays = member?.offDays ?? [];
    if (offDays.includes(weekDay)) {
      map[id] = staffOffDayBlockLabel(weekDay);
    }
  }
  return map;
}

export function mergeStaffBlockMaps(
  ...maps: Record<string, string>[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const map of maps) {
    for (const [id, label] of Object.entries(map)) {
      if (!merged[id]) merged[id] = label;
    }
  }
  return merged;
}
