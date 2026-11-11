/**
 * What happened on a business day, for the owner's voice assistant.
 *
 * Pure functions over already-loaded records (no database access), so the
 * day boundaries, money totals and per-staff matching can be unit tested.
 * Days are business days in the business's timezone. Only the last
 * {@link MAX_LOOKBACK_DAYS} days can be reported, and never the future.
 */
import { platformTodayIso, resolvePlatformTimeZone } from "@/lib/platform/timezone";

export const MAX_LOOKBACK_DAYS = 30;
const LIST_LIMIT = 10;

// ---------------------------------------------------------------------------
// Inputs (the tools layer maps Firestore documents to these)

export type ActivityJob = {
  code: string | null;
  service: string | null;
  customer: string | null;
  suburb: string | null;
  status: string;
  staffUid: string | null;
  staffName: string | null;
  visitStartedAt: number | null;
  visitEndedAt: number | null;
  cancelledAt: number | null;
  missedAt: number | null;
  missedReason: string | null;
};

export type ActivityInspection = ActivityJob & {
  createdAt: number | null;
  source: string | null;
  fromSophie: boolean;
};

export type ActivityQuote = {
  code: string | null;
  customer: string | null;
  valueAud: number;
  createdAt: number | null;
  createdByUid: string | null;
  customerDecision: string | null;
  customerDecisionAt: number | null;
  depositPaidAt: number | null;
  depositAud: number;
};

export type ActivityInvoice = {
  code: string | null;
  customer: string | null;
  status: string;
  /** Issue date (YYYY-MM-DD). */
  invoiceDate: string | null;
  totalAud: number;
  payments: { amountAud: number; paidAt: number | null }[];
  /** When it was marked paid by hand (not set on older invoices). */
  markedPaidAt: number | null;
};

export type ScheduledVisit = {
  kind: "job" | "inspection";
  code: string | null;
  status: string;
  staffUid: string | null;
  startTime: string | null;
};

export type ActivityStaff = {
  uid: string;
  name: string;
  offDay: boolean;
  approvedLeave: { fullDay: boolean; startTime: string | null; endTime: string | null }[];
};

export type ActivityCheckIn = {
  staffUid: string;
  checkInAt: number | null;
  checkOutAt: number | null;
  breakSeconds: number;
  workingSeconds: number | null;
};

// ---------------------------------------------------------------------------
// Dates

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Resolves the day the owner asked about: "today" (default), "yesterday" or
 * an ISO date (YYYY-MM-DD) within the last {@link MAX_LOOKBACK_DAYS} days.
 */
export function resolveReportDate(
  input: string | null | undefined,
  now: Date,
  timeZone?: string | null,
): { ok: true; date: string } | { ok: false; error: string } {
  const today = platformTodayIso(now, timeZone);
  const value = (input ?? "").trim().toLowerCase();
  if (!value || value === "today") return { ok: true, date: today };
  if (value === "yesterday") return { ok: true, date: shiftIso(today, -1) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || shiftIso(value, 0) !== value) {
    return { ok: false, error: "Use today, yesterday or a date as YYYY-MM-DD." };
  }
  if (value > today) return { ok: false, error: "That date is in the future." };
  if (value < shiftIso(today, -MAX_LOOKBACK_DAYS)) {
    return { ok: false, error: `Only the last ${MAX_LOOKBACK_DAYS} days can be reported.` };
  }
  return { ok: true, date: value };
}

/** True when the timestamp falls on the business day `date`. */
export function isOnDay(ms: number | null | undefined, date: string, timeZone: string): boolean {
  return typeof ms === "number" && Number.isFinite(ms) && platformTodayIso(new Date(ms), timeZone) === date;
}

export function clockTime(ms: number | null | undefined, timeZone: string): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${read("hour")}:${read("minute")}`;
}

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function page<T>(rows: T[]): { total: number; items: T[] } {
  return { total: rows.length, items: rows.slice(0, LIST_LIMIT) };
}

// ---------------------------------------------------------------------------
// Whole-business activity

/** Money received on the day: online payments, deposits and invoices marked paid by hand. */
export function paymentsReceivedOn(
  date: string,
  timeZone: string,
  invoices: ActivityInvoice[],
  quotes: ActivityQuote[],
): { totalAud: number; count: number } {
  let total = 0;
  let count = 0;
  for (const invoice of invoices) {
    if (invoice.status === "cancelled") continue;
    const online = invoice.payments.reduce((sum, payment) => sum + payment.amountAud, 0);
    for (const payment of invoice.payments) {
      if (isOnDay(payment.paidAt, date, timeZone)) {
        total += payment.amountAud;
        count += 1;
      }
    }
    // Marked paid by hand: the part not already paid online.
    if (invoice.status === "paid" && isOnDay(invoice.markedPaidAt, date, timeZone)) {
      const rest = invoice.totalAud - online;
      if (rest > 0) {
        total += rest;
        count += 1;
      }
    }
  }
  for (const quote of quotes) {
    if (quote.depositAud > 0 && isOnDay(quote.depositPaidAt, date, timeZone)) {
      total += quote.depositAud;
      count += 1;
    }
  }
  return { totalAud: money(total), count };
}

export function summarizeDayActivity(input: {
  date: string;
  timeZone?: string | null;
  jobs: ActivityJob[];
  inspections: ActivityInspection[];
  quotes: ActivityQuote[];
  quoteSentAt: { at: number | null; valueAud: number }[];
  invoices: ActivityInvoice[];
  scheduled: ScheduledVisit[];
}) {
  const { date } = input;
  const tz = resolvePlatformTimeZone(input.timeZone);
  const on = (ms: number | null | undefined) => isOnDay(ms, date, tz);
  const visit = (row: ActivityJob, at: number | null) => ({
    reference: row.code, service: row.service, customer: row.customer, suburb: row.suburb,
    staff: row.staffName, time: clockTime(at, tz),
  });

  const completedJobs = input.jobs.filter((job) => on(job.visitEndedAt))
    .sort((a, b) => (a.visitEndedAt ?? 0) - (b.visitEndedAt ?? 0));
  const startedNotFinished = input.jobs.filter((job) =>
    on(job.visitStartedAt) && !job.visitEndedAt && job.status === "ongoing");
  const missedJobs = input.jobs.filter((job) => on(job.missedAt));
  const cancelledJobs = input.jobs.filter((job) => on(job.cancelledAt));

  const newRequests = input.inspections.filter((request) => on(request.createdAt));
  const inspectionsDone = input.inspections.filter((request) => on(request.visitEndedAt));
  const bySource = newRequests.reduce<Record<string, number>>((totals, request) => {
    const key = request.fromSophie ? "sophie_call" : request.source ?? "other";
    totals[key] = (totals[key] ?? 0) + 1;
    return totals;
  }, {});

  const quotesCreated = input.quotes.filter((quote) => on(quote.createdAt));
  const quotesSent = input.quoteSentAt.filter((event) => on(event.at));
  const decided = (decision: string) =>
    input.quotes.filter((quote) => quote.customerDecision === decision && on(quote.customerDecisionAt));
  const accepted = decided("accepted");
  const declined = decided("rejected");

  const issued = input.invoices.filter((invoice) =>
    invoice.invoiceDate === date && (invoice.status === "sent" || invoice.status === "paid"));
  const received = paymentsReceivedOn(date, tz, input.invoices, input.quotes);
  const sum = (rows: { valueAud?: number; totalAud?: number }[]) =>
    money(rows.reduce((total, row) => total + (row.valueAud ?? row.totalAud ?? 0), 0));

  const scheduled = input.scheduled.filter((row) => row.status !== "cancelled");
  return {
    date,
    timeZone: tz,
    jobs: {
      scheduledForDay: scheduled.filter((row) => row.kind === "job").length,
      completed: { ...page(completedJobs.map((job) => visit(job, job.visitEndedAt))) },
      startedNotFinished: { ...page(startedNotFinished.map((job) => visit(job, job.visitStartedAt))) },
      missed: {
        ...page(missedJobs.map((job) => ({ ...visit(job, job.missedAt), reason: job.missedReason }))),
      },
      cancelled: page(cancelledJobs.map((job) => visit(job, job.cancelledAt))),
    },
    inspections: {
      scheduledForDay: scheduled.filter((row) => row.kind === "inspection").length,
      done: page(inspectionsDone.map((row) => visit(row, row.visitEndedAt))),
    },
    newRequests: { total: newRequests.length, bySource },
    quotes: {
      created: { count: quotesCreated.length, valueAud: sum(quotesCreated) },
      sent: { count: quotesSent.length, valueAud: sum(quotesSent) },
      accepted: { count: accepted.length, valueAud: sum(accepted) },
      declined: { count: declined.length, valueAud: sum(declined) },
    },
    invoices: {
      issued: { count: issued.length, valueAud: sum(issued) },
      paymentsReceived: received,
    },
  };
}

// ---------------------------------------------------------------------------
// Per staff member

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Staff whose name matches what the owner said (full name, or any part of it). */
export function matchStaff(staff: ActivityStaff[], query: string | null | undefined): ActivityStaff[] {
  const wanted = normalise(query ?? "");
  if (!wanted) return staff;
  const exact = staff.filter((member) => normalise(member.name) === wanted);
  if (exact.length) return exact;
  return staff.filter((member) => {
    const name = normalise(member.name);
    return name.includes(wanted) || wanted.split(" ").every((part) => name.split(" ").includes(part));
  });
}

export function summarizeStaffDay(input: {
  date: string;
  timeZone?: string | null;
  now: Date;
  staff: ActivityStaff[];
  checkIns: ActivityCheckIn[];
  jobs: ActivityJob[];
  inspections: ActivityInspection[];
  quotes: ActivityQuote[];
  scheduled: ScheduledVisit[];
}) {
  const { date } = input;
  const tz = resolvePlatformTimeZone(input.timeZone);
  const on = (ms: number | null | undefined) => isOnDay(ms, date, tz);

  return input.staff.map((member) => {
    const sessions = input.checkIns
      .filter((row) => row.staffUid === member.uid && on(row.checkInAt))
      .sort((a, b) => (a.checkInAt ?? 0) - (b.checkInAt ?? 0));
    const workedSeconds = sessions.reduce((total, row) => {
      if (typeof row.workingSeconds === "number") return total + Math.max(0, row.workingSeconds);
      // Still clocked in: count up to now.
      const end = row.checkOutAt ?? input.now.getTime();
      return total + Math.max(0, Math.floor((end - (row.checkInAt ?? end)) / 1000) - row.breakSeconds);
    }, 0);
    const breakSeconds = sessions.reduce((total, row) => total + row.breakSeconds, 0);

    const mine = <T extends ActivityJob>(rows: T[]) => rows.filter((row) => row.staffUid === member.uid);
    const jobs = mine(input.jobs);
    const completed = jobs.filter((job) => on(job.visitEndedAt))
      .sort((a, b) => (a.visitEndedAt ?? 0) - (b.visitEndedAt ?? 0));
    const inProgress = jobs.filter((job) => on(job.visitStartedAt) && !job.visitEndedAt && job.status === "ongoing");
    const missed = jobs.filter((job) => on(job.missedAt));
    const inspectionsDone = mine(input.inspections).filter((row) => on(row.visitEndedAt));
    const quotesCreated = input.quotes.filter((quote) => quote.createdByUid === member.uid && on(quote.createdAt));
    const assigned = input.scheduled.filter((row) => row.staffUid === member.uid && row.status !== "cancelled");

    const item = (row: ActivityJob, at: number | null) => ({
      reference: row.code, service: row.service, suburb: row.suburb, time: clockTime(at, tz),
    });
    return {
      name: member.name,
      offDay: member.offDay,
      approvedLeave: member.approvedLeave,
      attendance: {
        sessions: sessions.map((row) => ({
          clockedIn: clockTime(row.checkInAt, tz),
          clockedOut: clockTime(row.checkOutAt, tz),
          stillClockedIn: !row.checkOutAt,
        })),
        workedMinutes: Math.round(workedSeconds / 60),
        breakMinutes: Math.round(breakSeconds / 60),
      },
      visitsAssignedForDay: assigned.length,
      jobsCompleted: page(completed.map((job) => item(job, job.visitEndedAt))),
      jobsInProgress: page(inProgress.map((job) => item(job, job.visitStartedAt))),
      jobsMissed: page(missed.map((job) => ({ ...item(job, job.missedAt), reason: job.missedReason }))),
      inspectionsDone: inspectionsDone.length,
      quotesCreated: {
        count: quotesCreated.length,
        valueAud: money(quotesCreated.reduce((total, quote) => total + quote.valueAud, 0)),
      },
    };
  });
}
