import { clockLabel } from "../hours";
import { COMPLAINT_TYPES, type ComplaintType } from "../types";

/**
 * The owner's return-visit rule (docs/sophie-email-learning-and-auto-reply.md §10.10). Pure.
 * "We do warranty visits on Saturday mornings", "within 2 business days", "the first free time".
 * The owner approves one exact version; only its fixed fields give Sophie any permission, never
 * words in knowledge. It is about TIME and the owner's own work, never about money: refunds,
 * discounts and credits are the compensation guide, which only ever prepares a one-tap proposal.
 */

export type ReturnVisitWindow =
  /** The next `count` Saturdays, between the two times. */
  | { kind: "saturdays"; count: number; startTime: string; endTime: string }
  /** The next `days` open business days, in business hours. */
  | { kind: "business_days"; days: number }
  /** The first free time within `withinDays`. */
  | { kind: "first_free"; withinDays: number };

export type ReturnVisitPolicy = {
  version: number;
  window: ReturnVisitWindow;
  /** Which complaints it covers. Never damage, safety, conduct or billing. */
  appliesTo: ComplaintType[];
  /** The job must have been completed within this many days. */
  maxJobAgeDays: number;
  /** The return visit is at no charge, from the owner's warranty policy. */
  noCharge: boolean;
  /** At most this many return visits a week. */
  weeklyLimit: number;
};

/** Never covered by a return-visit rule, whatever the owner ticks (§10.10). */
export const NEVER_RETURN_VISIT: readonly ComplaintType[] = ["damage", "safety", "conduct", "billing"];

export const DEFAULT_RETURN_VISIT_TYPES: ComplaintType[] = ["work_unfinished", "repeat_fault"];

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const int = (value: unknown, min: number, max: number) => (Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : null);

export type ParsedPolicy = { ok: true; policy: Omit<ReturnVisitPolicy, "version"> } | { ok: false; error: string };

/** Checks a policy from the settings screen. Anything unclear is refused, never guessed. */
export function parseReturnVisitPolicy(raw: unknown): ParsedPolicy {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Choose when return visits happen." };
  const value = raw as Record<string, unknown>;
  const window = value.window as Record<string, unknown> | undefined;
  let parsed: ReturnVisitWindow | null = null;
  if (window?.kind === "saturdays") {
    const count = int(window.count, 1, 6);
    const start = typeof window.startTime === "string" && CLOCK.test(window.startTime) ? window.startTime : null;
    const end = typeof window.endTime === "string" && CLOCK.test(window.endTime) ? window.endTime : null;
    if (count === null || !start || !end || start >= end) return { ok: false, error: "Saturdays need a number of weeks and a start before the end time (for example 8 am to 12 pm)." };
    parsed = { kind: "saturdays", count, startTime: start, endTime: end };
  } else if (window?.kind === "business_days") {
    const days = int(window.days, 1, 14);
    if (days === null) return { ok: false, error: "Say how many business days: 1 to 14." };
    parsed = { kind: "business_days", days };
  } else if (window?.kind === "first_free") {
    const withinDays = int(window.withinDays, 1, 30);
    if (withinDays === null) return { ok: false, error: "Say how many days ahead to look: 1 to 30." };
    parsed = { kind: "first_free", withinDays };
  }
  if (!parsed) return { ok: false, error: "Choose Saturdays, within some business days, or the first free time." };

  const types = Array.isArray(value.appliesTo) ? value.appliesTo : DEFAULT_RETURN_VISIT_TYPES;
  const appliesTo = [...new Set(types)].filter((type): type is ComplaintType => (COMPLAINT_TYPES as readonly unknown[]).includes(type));
  if (appliesTo.length !== types.length || appliesTo.length === 0) return { ok: false, error: "Choose which complaints it covers." };
  if (appliesTo.some((type) => NEVER_RETURN_VISIT.includes(type))) {
    return { ok: false, error: "A return-visit rule can't cover damage, safety, conduct or billing complaints. You decide those yourself." };
  }
  const maxJobAgeDays = int(value.maxJobAgeDays ?? 30, 1, 90);
  const weeklyLimit = int(value.weeklyLimit ?? 5, 1, 20);
  if (maxJobAgeDays === null || weeklyLimit === null) return { ok: false, error: "Check the job age (1 to 90 days) and the weekly limit (1 to 20)." };
  return { ok: true, policy: { window: parsed, appliesTo, maxJobAgeDays, noCharge: value.noCharge === true, weeklyLimit } };
}

const TYPE_WORDS: Partial<Record<ComplaintType, string>> = {
  work_unfinished: "the work isn't finished", repeat_fault: "the same fault is back", quality: "the work isn't up to standard",
  missed_visit: "a visit was missed", late_arrival: "we were late", no_update: "they haven't heard from us",
};

/** The rule read back in plain words, for the owner to approve (§10.10). */
export function describeReturnVisitPolicy(policy: Omit<ReturnVisitPolicy, "version">): string {
  const when = policy.window.kind === "saturdays"
    ? `the next ${policy.window.count === 1 ? "Saturday" : `${policy.window.count} Saturdays`}, ${clockLabel(policy.window.startTime)} to ${clockLabel(policy.window.endTime)}`
    : policy.window.kind === "business_days"
      ? `within ${policy.window.days} business day${policy.window.days === 1 ? "" : "s"}`
      : `the first free time in the next ${policy.window.withinDays} days`;
  const what = policy.appliesTo.map((type) => TYPE_WORDS[type] ?? type).join(" or ");
  return `When a verified customer says ${what} about a job we completed in the last ${policy.maxJobAgeDays} days, offer two free times ${when}, ${policy.noCharge ? "at no charge" : "charged as usual"}, with the same technician if free. At most ${policy.weeklyLimit} return visits a week. You confirm each offer.`;
}

export type ApplyFacts = {
  type: ComplaintType | null;
  /** YYYY-MM-DD the job was completed or last visited. */
  jobDate: string | null;
  today: string;
  /** The technician said the work isn't finished, or the owner marked it as our work. */
  confirmedOurWork: boolean;
  /** A return visit was already offered or booked for this job. */
  hadReturnVisit: boolean;
  returnVisitsThisWeek: number;
};

export type Applies = { applies: true } | { applies: false; reason: string };

/** Whether the owner's rule covers this complaint right now. */
export function returnVisitApplies(policy: Omit<ReturnVisitPolicy, "version">, facts: ApplyFacts): Applies {
  if (!facts.type || !policy.appliesTo.includes(facts.type)) return { applies: false, reason: "Your rule doesn't cover this kind of complaint." };
  if (facts.hadReturnVisit) return { applies: false, reason: "There was already a return visit for this job. Your rule allows one." };
  if (!facts.confirmedOurWork) return { applies: false, reason: "Nobody has confirmed it's our work yet: the technician hasn't said, or you haven't marked it." };
  if (!facts.jobDate) return { applies: false, reason: "The job's date isn't recorded." };
  const age = (Date.parse(`${facts.today}T00:00:00Z`) - Date.parse(`${facts.jobDate}T00:00:00Z`)) / 86_400_000;
  if (age > policy.maxJobAgeDays) return { applies: false, reason: `The job was more than ${policy.maxJobAgeDays} days ago.` };
  if (facts.returnVisitsThisWeek >= policy.weeklyLimit) return { applies: false, reason: `You've reached ${policy.weeklyLimit} return visits this week.` };
  return { applies: true };
}
