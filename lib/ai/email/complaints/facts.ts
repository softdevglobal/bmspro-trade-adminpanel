import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";

import { clockLabel, dateLabel } from "../hours";
import type { ComplaintType } from "../types";
import type { ComplaintJob } from "./find-job";

/**
 * The fact sheet for a complaint (docs/sophie-email-learning-and-auto-reply.md §10.4 step 5). Pure:
 * code collects the facts from the records, the AI doesn't. Each fact shows where it came from, and
 * anything missing says "not recorded" and is never guessed. For the owner's card only: nothing
 * here goes to the customer.
 */

export type Fact = { label: string; value: string; source: string };

export type StaffCheckIn = { checkInAt: number | null; checkOutAt: number | null };

const NOT_RECORDED = "not recorded";

const time = (at: number | null, timeZone: string) =>
  at === null ? NOT_RECORDED : new Intl.DateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at)).replace(/\s+/g, " ");

/** "52 minutes", "1 hour 5 minutes". */
export function durationLabel(minutes: number): string {
  const rounded = Math.round(Math.abs(minutes));
  if (rounded < 60) return `${rounded} minute${rounded === 1 ? "" : "s"}`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${hours} hour${hours === 1 ? "" : "s"}${rest ? ` ${rest} minute${rest === 1 ? "" : "s"}` : ""}`;
}

/** Minutes the visit started after the booked window opened and ended (negative: before). Null when not recorded. */
export function latenessMinutes(job: Pick<ComplaintJob, "date" | "startTime" | "endTime" | "visitStartedAt">, timeZone: string): { afterStart: number; afterEnd: number | null } | null {
  if (!job.date || !job.startTime || job.visitStartedAt === null) return null;
  const windowStart = zonedDateTimeToUtcMs(job.date, job.startTime, timeZone);
  const windowEnd = job.endTime ? zonedDateTimeToUtcMs(job.date, job.endTime, timeZone) : null;
  if (windowStart === null) return null;
  return { afterStart: (job.visitStartedAt - windowStart) / 60_000, afterEnd: windowEnd === null ? null : (job.visitStartedAt - windowEnd) / 60_000 };
}

/** How the visit started against the booked window, in words. Null when either side isn't recorded. */
export function lateness(job: Pick<ComplaintJob, "date" | "startTime" | "endTime" | "visitStartedAt">, timeZone: string): string | null {
  const minutes = latenessMinutes(job, timeZone);
  if (!minutes) return null;
  const minutesAfterStart = minutes.afterStart;
  if (minutes.afterEnd !== null && minutes.afterEnd > 0) {
    return `started ${durationLabel(minutes.afterEnd)} after the booked window ended`;
  }
  if (minutesAfterStart > 0) return `started ${durationLabel(minutesAfterStart)} after the window opened, inside the booked window`;
  return "started at or before the booked window opened";
}

export function buildFacts(input: { type: ComplaintType | null; job: ComplaintJob; checkIns: readonly StaffCheckIn[]; timeZone: string; /** The customer's other jobs. */ otherJobs?: readonly ComplaintJob[] }): Fact[] {
  const { job, timeZone } = input;
  const facts: Fact[] = [];
  const add = (label: string, value: string | null | undefined, source: string) => facts.push({ label, value: value?.trim() || NOT_RECORDED, source });

  add("Job", [job.code, job.serviceName].filter(Boolean).join(" · "), "jobs");
  add("Status", job.status, "jobs.status");
  const window = job.date
    ? `${dateLabel(job.date)}${job.startTime ? `, ${clockLabel(job.startTime)}${job.endTime ? ` to ${clockLabel(job.endTime)}` : ""}` : ""}`
    : null;
  add("Booked", window, "jobs.scheduledSlot");
  add("Assigned to", job.staffName, "jobs.assignedTo");
  add("Visit started", time(job.visitStartedAt, timeZone), "jobs.visitStartedAt");
  add("Visit ended", time(job.visitEndedAt, timeZone), "jobs.visitEndedAt");

  if (input.type === "late_arrival" || input.type === "no_update" || input.type === "missed_visit") {
    add("Compared with the booking", lateness(job, timeZone), "worked out from the booked window and the visit start");
  }
  if (job.date) {
    const dayStart = zonedDateTimeToUtcMs(job.date, "00:00", timeZone);
    const dayEnd = dayStart === null ? null : dayStart + 24 * 60 * 60_000;
    const that = input.checkIns.filter((item) => dayStart !== null && dayEnd !== null && item.checkInAt !== null && item.checkInAt >= dayStart && item.checkInAt < dayEnd);
    add("Technician checked in", that.length ? that.map((item) => `${time(item.checkInAt, timeZone)} to ${time(item.checkOutAt, timeZone)}`).join("; ") : null, "staff_check_ins");
  }
  // Earlier visits at the same address, so a "same problem again" complaint shows its history (S04).
  if (input.type === "repeat_fault" || input.type === "work_unfinished") {
    const same = (input.otherJobs ?? []).filter((other) => other.id !== job.id && other.status === "completed" && !!job.address && other.address === job.address);
    add("Earlier visits at this address", same.length ? same.slice(0, 5).map((other) => `${other.code}${other.date ? ` (${dateLabel(other.date)})` : ""}`).join("; ") : "none recorded", "jobs, same customer and address");
  }
  if (input.type === "missed_visit" || job.status === "missed") add("Why a visit was missed", job.missedReason, "jobs.missedReason");
  return facts;
}
