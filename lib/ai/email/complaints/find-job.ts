/**
 * Finding the job a complaint is about (docs/sophie-email-learning-and-auto-reply.md §10.4 step 1).
 * Pure. The reference in the email if there is one, otherwise the verified customer's visits in the
 * last 30 days. Exactly one match, or the owner picks: Sophie never guesses.
 */

export type ComplaintJob = {
  id: string;
  /** "BK 4K7H2M9P". */
  code: string;
  status: string;
  serviceName: string | null;
  /** The visit day, YYYY-MM-DD in the business time zone; null when never scheduled. */
  date: string | null;
  /** "09:00"–"11:00", the booked window. */
  startTime: string | null;
  endTime: string | null;
  staffUid: string | null;
  staffName: string | null;
  visitStartedAt: number | null;
  visitEndedAt: number | null;
  missedReason: string | null;
  /** The visit length in minutes, when recorded. */
  durationMinutes: number | null;
  /** The job site, as one line, to find earlier visits at the same address (§10.4 step 5). */
  address?: string | null;
};

export type FoundJob =
  | { outcome: "one"; job: ComplaintJob; how: "reference" | "recent" }
  | { outcome: "ask_owner"; reason: "not_found" | "several" | "none_recent"; candidates: ComplaintJob[] };

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;
/** Jobs that can have gone wrong: not a cancelled booking, not one that hasn't happened yet. */
const HAPPENED = new Set(["completed", "ongoing", "missed", "scheduled"]);

/** "bk 4k7h-2m9p", "BK4K7H2M9P" and "4K7H2M9P" all compare as the same reference. */
const squash = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const stripPrefix = (value: string) => value.replace(/^(BK|JOB)/, "");

export function findComplaintJob(input: { jobRef: string | null; jobs: readonly ComplaintJob[]; now: number; timeZone: string }): FoundJob {
  const { jobs } = input;
  const ref = input.jobRef ? stripPrefix(squash(input.jobRef)) : "";
  if (ref.length >= 4) {
    const matches = jobs.filter((job) => stripPrefix(squash(job.code)) === ref);
    if (matches.length === 1) return { outcome: "one", job: matches[0], how: "reference" };
    return { outcome: "ask_owner", reason: matches.length === 0 ? "not_found" : "several", candidates: matches.slice(0, 5) };
  }

  const today = localDay(input.now, input.timeZone);
  const earliest = localDay(input.now - WINDOW_DAYS * DAY_MS, input.timeZone);
  const recent = jobs.filter((job) => HAPPENED.has(job.status) && job.date !== null && today !== null && earliest !== null && job.date >= earliest && job.date <= today);
  if (recent.length === 1) return { outcome: "one", job: recent[0], how: "recent" };
  return { outcome: "ask_owner", reason: recent.length === 0 ? "none_recent" : "several", candidates: recent.slice(0, 5) };
}

function localDay(at: number, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  } catch {
    return null;
  }
}
