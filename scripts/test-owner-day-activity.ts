/**
 * Unit tests for the owner voice "what happened on a day" reports.
 *
 * Run: npm run test:owner-day-activity
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOnDay,
  matchStaff,
  resolveReportDate,
  summarizeDayActivity,
  summarizeStaffDay,
  type ActivityInspection,
  type ActivityInvoice,
  type ActivityJob,
  type ActivityQuote,
  type ActivityStaff,
} from "../lib/ai/owner-call/day-activity";

const TZ = "Australia/Melbourne"; // UTC+11 in November (AEDT)
const DAY = "2026-11-10";
/** A Melbourne wall-clock time on DAY, as epoch ms. */
const at = (hhmm: string, day = DAY) => Date.parse(`${day}T${hhmm}:00+11:00`);
const NOW = new Date(at("18:00"));

const job = (o: Partial<ActivityJob>): ActivityJob => ({
  code: "JOB 1", service: "Blocked drain", customer: "Sam", suburb: "Carlton", status: "scheduled",
  staffUid: "kasun", staffName: "Kasun Perera", visitStartedAt: null, visitEndedAt: null,
  cancelledAt: null, missedAt: null, missedReason: null, ...o,
});
const inspection = (o: Partial<ActivityInspection>): ActivityInspection => ({
  ...job({ code: "REQ 1" }), createdAt: null, source: "booking_engine", fromSophie: false, ...o,
});
const quote = (o: Partial<ActivityQuote>): ActivityQuote => ({
  code: "QT 1", customer: "Sam", valueAud: 100, createdAt: null, createdByUid: "owner",
  customerDecision: null, customerDecisionAt: null, depositPaidAt: null, depositAud: 0, ...o,
});
const invoice = (o: Partial<ActivityInvoice>): ActivityInvoice => ({
  code: "INV 1", customer: "Sam", status: "sent", invoiceDate: DAY, totalAud: 100,
  payments: [], markedPaidAt: null, ...o,
});
const staff: ActivityStaff[] = [
  { uid: "kasun", name: "Kasun Perera", offDay: false, approvedLeave: [] },
  { uid: "nimal", name: "Nimal Silva", offDay: false, approvedLeave: [] },
];

describe("resolveReportDate", () => {
  it("defaults to the business day, and knows yesterday", () => {
    assert.deepEqual(resolveReportDate(undefined, NOW, TZ), { ok: true, date: DAY });
    assert.deepEqual(resolveReportDate("Today", NOW, TZ), { ok: true, date: DAY });
    assert.deepEqual(resolveReportDate("yesterday", NOW, TZ), { ok: true, date: "2026-11-09" });
  });

  it("uses the business timezone, not UTC", () => {
    // 23:30 UTC on the 10th is already the 11th in Melbourne.
    const lateUtc = new Date("2026-11-10T23:30:00Z");
    assert.deepEqual(resolveReportDate(undefined, lateUtc, TZ), { ok: true, date: "2026-11-11" });
  });

  it("accepts the last 30 days and refuses the future, older days and bad input", () => {
    assert.equal(resolveReportDate("2026-10-11", NOW, TZ).ok, true);
    assert.equal(resolveReportDate("2026-10-10", NOW, TZ).ok, false);
    assert.equal(resolveReportDate("2026-11-11", NOW, TZ).ok, false);
    assert.equal(resolveReportDate("2026-02-30", NOW, TZ).ok, false);
    assert.equal(resolveReportDate("last monday", NOW, TZ).ok, false);
  });
});

describe("isOnDay", () => {
  it("splits days at local midnight", () => {
    assert.equal(isOnDay(at("00:00"), DAY, TZ), true);
    assert.equal(isOnDay(at("23:59"), DAY, TZ), true);
    assert.equal(isOnDay(at("23:59", "2026-11-09"), DAY, TZ), false);
    assert.equal(isOnDay(null, DAY, TZ), false);
  });
});

describe("summarizeDayActivity", () => {
  const result = summarizeDayActivity({
    date: DAY,
    timeZone: TZ,
    jobs: [
      job({ code: "JOB 1", status: "completed", visitStartedAt: at("09:00"), visitEndedAt: at("10:30") }),
      job({ code: "JOB 2", status: "ongoing", visitStartedAt: at("14:00"), staffUid: "nimal", staffName: "Nimal Silva" }),
      job({ code: "JOB 3", status: "missed", missedAt: at("12:00"), missedReason: "Customer not home" }),
      job({ code: "JOB 4", status: "cancelled", cancelledAt: at("08:00") }),
      job({ code: "OLD", status: "completed", visitEndedAt: at("10:00", "2026-11-09") }),
    ],
    inspections: [
      inspection({ code: "REQ 1", createdAt: at("11:00"), fromSophie: true }),
      inspection({ code: "REQ 2", createdAt: at("13:00"), source: "owner_dashboard" }),
      inspection({ code: "REQ 3", status: "completed", visitEndedAt: at("16:00") }),
    ],
    quotes: [
      quote({ createdAt: at("09:00"), valueAud: 400 }),
      quote({ createdAt: at("09:30", "2026-11-01"), customerDecision: "accepted", customerDecisionAt: at("15:00"), valueAud: 1200 }),
      quote({ customerDecision: "rejected", customerDecisionAt: at("15:30"), valueAud: 300 }),
      quote({ depositAud: 150, depositPaidAt: at("10:00") }),
    ],
    quoteSentAt: [{ at: at("09:05"), valueAud: 400 }, { at: at("09:05", "2026-11-08"), valueAud: 999 }],
    invoices: [
      invoice({ code: "INV 1", totalAud: 500, payments: [{ amountAud: 500, paidAt: at("17:00") }], status: "paid" }),
      // $100 paid online last week, rest marked paid by hand today.
      invoice({ code: "INV 2", invoiceDate: "2026-11-02", totalAud: 300, status: "paid",
        payments: [{ amountAud: 100, paidAt: at("10:00", "2026-11-03") }], markedPaidAt: at("12:00") }),
      invoice({ code: "INV 3", totalAud: 250 }),
      invoice({ code: "INV 4", status: "draft", totalAud: 999 }),
    ],
    scheduled: [
      { kind: "job", code: "JOB 1", status: "completed", staffUid: "kasun", startTime: "09:00" },
      { kind: "job", code: "JOB 4", status: "cancelled", staffUid: "kasun", startTime: "08:00" },
      { kind: "inspection", code: "REQ 3", status: "completed", staffUid: "nimal", startTime: "15:00" },
    ],
  });

  it("reports work done on that day only, with staff and local times", () => {
    assert.equal(result.jobs.completed.total, 1);
    assert.deepEqual(result.jobs.completed.items[0], {
      reference: "JOB 1", service: "Blocked drain", customer: "Sam", suburb: "Carlton",
      staff: "Kasun Perera", time: "10:30",
    });
    assert.equal(result.jobs.startedNotFinished.items[0].staff, "Nimal Silva");
    assert.equal(result.jobs.missed.items[0].reason, "Customer not home");
    assert.equal(result.jobs.cancelled.total, 1);
    assert.equal(result.jobs.scheduledForDay, 1, "cancelled visits are not counted as scheduled");
    assert.equal(result.inspections.done.total, 1);
  });

  it("counts new requests by where they came from", () => {
    assert.deepEqual(result.newRequests, { total: 2, bySource: { sophie_call: 1, owner_dashboard: 1 } });
  });

  it("reports quotes created, sent, accepted and declined with values", () => {
    assert.deepEqual(result.quotes, {
      created: { count: 1, valueAud: 400 },
      sent: { count: 1, valueAud: 400 },
      accepted: { count: 1, valueAud: 1200 },
      declined: { count: 1, valueAud: 300 },
    });
  });

  it("totals invoices issued and money received (online, deposits, marked paid)", () => {
    assert.deepEqual(result.invoices.issued, { count: 2, valueAud: 750 });
    // 500 online + 150 deposit + 200 marked paid (300 total - 100 paid online earlier)
    assert.deepEqual(result.invoices.paymentsReceived, { totalAud: 850, count: 3 });
  });
});

describe("summarizeStaffDay", () => {
  const report = summarizeStaffDay({
    date: DAY,
    timeZone: TZ,
    now: NOW,
    staff,
    checkIns: [
      { staffUid: "kasun", checkInAt: at("07:58"), checkOutAt: at("16:30"), breakSeconds: 1800, workingSeconds: 29_520 },
      // Still clocked in at 18:00: 16:00 -> 18:00, minus a 15 minute break.
      { staffUid: "nimal", checkInAt: at("16:00"), checkOutAt: null, breakSeconds: 900, workingSeconds: null },
      { staffUid: "nimal", checkInAt: at("08:00", "2026-11-09"), checkOutAt: at("16:00", "2026-11-09"), breakSeconds: 0, workingSeconds: 28_800 },
    ],
    jobs: [
      job({ code: "JOB 1", status: "completed", visitStartedAt: at("09:00"), visitEndedAt: at("10:30") }),
      job({ code: "JOB 2", status: "ongoing", visitStartedAt: at("16:30"), staffUid: "nimal", staffName: "Nimal Silva" }),
      job({ code: "JOB 3", status: "missed", missedAt: at("12:00"), missedReason: "No access" }),
    ],
    inspections: [inspection({ status: "completed", visitEndedAt: at("15:00"), staffUid: "nimal" })],
    quotes: [quote({ createdByUid: "kasun", createdAt: at("11:00"), valueAud: 350 })],
    scheduled: [
      { kind: "job", code: "JOB 1", status: "completed", staffUid: "kasun", startTime: "09:00" },
      { kind: "job", code: "JOB 3", status: "missed", staffUid: "kasun", startTime: "12:00" },
    ],
  });
  const kasun = report.find((row) => row.name === "Kasun Perera")!;
  const nimal = report.find((row) => row.name === "Nimal Silva")!;

  it("gives each person's hours, jobs and quotes for the day", () => {
    assert.deepEqual(kasun.attendance, {
      sessions: [{ clockedIn: "07:58", clockedOut: "16:30", stillClockedIn: false }],
      workedMinutes: 492,
      breakMinutes: 30,
    });
    assert.equal(kasun.jobsCompleted.items[0].time, "10:30");
    assert.equal(kasun.jobsMissed.items[0].reason, "No access");
    assert.deepEqual(kasun.quotesCreated, { count: 1, valueAud: 350 });
    assert.equal(kasun.visitsAssignedForDay, 2);
  });

  it("counts an open shift up to now and ignores other days", () => {
    assert.deepEqual(nimal.attendance.sessions, [{ clockedIn: "16:00", clockedOut: null, stillClockedIn: true }]);
    assert.equal(nimal.attendance.workedMinutes, 105);
    assert.equal(nimal.jobsInProgress.total, 1);
    assert.equal(nimal.inspectionsDone, 1);
    assert.equal(nimal.jobsCompleted.total, 0);
  });
});

describe("matchStaff", () => {
  it("finds staff by full or first name, ignoring case", () => {
    assert.deepEqual(matchStaff(staff, "kasun").map((s) => s.uid), ["kasun"]);
    assert.deepEqual(matchStaff(staff, "Nimal Silva").map((s) => s.uid), ["nimal"]);
    assert.deepEqual(matchStaff(staff, "  ").map((s) => s.uid), ["kasun", "nimal"]);
    assert.deepEqual(matchStaff(staff, "Ruwan"), []);
  });
});
