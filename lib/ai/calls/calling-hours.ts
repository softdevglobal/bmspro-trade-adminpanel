import type { SophieCallingHours } from "@/lib/onboarding/server";
import { DEFAULT_SOPHIE_CALLING_HOURS } from "@/lib/onboarding/server";

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Fail closed when the business timezone or configured hours are invalid. */
export function isWithinSophieCallingHours(
  timestamp: number,
  timezone: string,
  hours: SophieCallingHours = DEFAULT_SOPHIE_CALLING_HOURS,
) {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const weekday = values.weekday;
    if (hours.weekdaysOnly && (weekday === "Sat" || weekday === "Sun")) return false;
    const current = Number(values.hour) * 60 + Number(values.minute);
    return current >= minutes(hours.start) && current < minutes(hours.end);
  } catch {
    return false;
  }
}
