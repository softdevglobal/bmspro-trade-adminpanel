/**
 * Unit tests for expenses: Sophie's receipt reading checks, duplicates,
 * spending limits, report periods and totals, the CSV and settings.
 *
 * Run: npm run test:expenses
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readReceipt,
  receiptAnalysisConfig,
  resolveReceiptReading,
  type ReceiptContext,
} from "../lib/expenses/receipt-analysis";
import {
  csvCell,
  expenseFingerprint,
  expensesCsv,
  isOverSpendingLimit,
  missingExpenseFields,
  monthPeriodContaining,
  previousMonthPeriod,
  previousWeekPeriod,
  reportsDueOn,
  statusAfterSubmit,
  summarizeExpenses,
  vendorKey,
  weekPeriodContaining,
} from "../lib/expenses/rules";
import {
  DEFAULT_SPENDING_LIMIT_AUD,
  normalizeExpenseSettingsPatch,
  parseExpenseSettings,
  type ExpenseRecord,
} from "../lib/expenses/types";

const CONTEXT: ReceiptContext = {
  todayIso: "2026-11-26",
  vehicles: [
    { id: "van1", name: "Van 1", rego: "ABC123" },
    { id: "van2", name: "Van 2", rego: "XYZ789" },
  ],
  jobs: [
    { id: "job-a", label: "BK 1 · Hot water · Parramatta", date: "2026-11-24" },
    { id: "job-b", label: "BK 2 · Leak · Ryde", date: "2026-11-25" },
    { id: "job-c", label: "BK 3 · Leak · Epping", date: "2026-11-25" },
  ],
  submitterVehicleId: "van2",
};

function reading(overrides: Record<string, unknown>) {
  return {
    isReceipt: true,
    vendor: "Shell Parramatta",
    date: "2026-11-24",
    totalAud: 85,
    gstAud: 7.73,
    pricesIncludeGst: true,
    category: "fuel",
    reason: "Diesel for work van",
    vehicleId: null,
    jobId: null,
    confidence: "high",
    checks: [],
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id: "e1",
    businessId: "biz",
    expenseCode: "EXP-0001",
    status: "pending",
    vendor: "Shell",
    date: "2026-11-24",
    amountAud: 85,
    gstAud: 7.73,
    category: "fuel",
    reason: null,
    vehicleId: null,
    vehicleLabel: null,
    jobId: null,
    jobLabel: null,
    paidWith: "business",
    receipt: { url: "https://x", path: "expenses/biz/u/r.jpg", contentType: "image/jpeg", sha256: "abc" },
    submittedBy: { uid: "jo", name: "Jo", role: "staff" },
    sophie: null,
    missing: [],
    overLimit: false,
    limitAud: 300,
    duplicateOfId: null,
    decision: null,
    reimbursement: { status: "not_needed", by: null, at: null, note: null },
    receiptRequest: null,
    submittedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("Sophie's receipt reading", () => {
  it("keeps a clean reading and links fuel to the submitter's usual vehicle", () => {
    const result = resolveReceiptReading(reading({}), CONTEXT);
    assert.equal(result.vendor, "Shell Parramatta");
    assert.equal(result.date, "2026-11-24");
    assert.equal(result.amountAud, 85);
    assert.equal(result.gstAud, 7.73);
    assert.equal(result.category, "fuel");
    assert.equal(result.vehicleId, "van2");
    assert.match(result.checks.join(" "), /Van 2, the vehicle you usually drive/);
  });

  it("uses a vehicle the receipt shows, and ignores ids that aren't the business's", () => {
    assert.equal(resolveReceiptReading(reading({ vehicleId: "van1" }), CONTEXT).vehicleId, "van1");
    const madeUp = resolveReceiptReading(reading({ vehicleId: "truck9", category: "tools" }), CONTEXT);
    assert.equal(madeUp.vehicleId, null);
    assert.equal(resolveReceiptReading(reading({ jobId: "job-zzz" }), CONTEXT).jobId, null);
  });

  it("links materials to the only job that day, but not when there are two", () => {
    const one = resolveReceiptReading(reading({ category: "materials", date: "2026-11-24" }), CONTEXT);
    assert.equal(one.jobId, "job-a");
    const two = resolveReceiptReading(reading({ category: "materials", date: "2026-11-25" }), CONTEXT);
    assert.equal(two.jobId, null);
  });

  it("blanks future dates and impossible amounts", () => {
    const future = resolveReceiptReading(reading({ date: "2026-12-30" }), CONTEXT);
    assert.equal(future.date, null);
    assert.match(future.checks.join(" "), /future/);
    assert.equal(resolveReceiptReading(reading({ date: "2026-02-31" }), CONTEXT).date, null);
    assert.equal(resolveReceiptReading(reading({ totalAud: -5 }), CONTEXT).amountAud, null);
    assert.equal(resolveReceiptReading(reading({ totalAud: 5_000_000 }), CONTEXT).amountAud, null);
  });

  it("works out GST as 1/11 only when the receipt says prices include it", () => {
    const worked = resolveReceiptReading(reading({ gstAud: null, totalAud: 110 }), CONTEXT);
    assert.equal(worked.gstAud, 10);
    assert.match(worked.checks.join(" "), /1\/11/);
    const notShown = resolveReceiptReading(reading({ gstAud: null, pricesIncludeGst: false }), CONTEXT);
    assert.equal(notShown.gstAud, null);
    const tooBig = resolveReceiptReading(reading({ gstAud: 90, totalAud: 85, pricesIncludeGst: false }), CONTEXT);
    assert.equal(tooBig.gstAud, null);
    assert.match(tooBig.checks.join(" "), /more than the total/);
    const tooBigInclusive = resolveReceiptReading(reading({ gstAud: 90, totalAud: 85 }), CONTEXT);
    assert.equal(tooBigInclusive.gstAud, 7.73);
  });

  it("flags photos that aren't receipts and unknown categories", () => {
    const result = resolveReceiptReading(reading({ isReceipt: false, category: "spaceship" }), CONTEXT);
    assert.equal(result.isReceipt, false);
    assert.equal(result.category, "other");
    assert.match(result.checks[0], /doesn't think this photo is a receipt/);
  });

  it("calls the vision API with the image and reads its JSON answer", async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reading({})) } }] }), { status: 200 });
    }) as typeof fetch;
    const result = await readReceipt({
      config: { url: "https://ai.test/v1", key: "k", model: "m" },
      image: { bytes: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" },
      context: CONTEXT,
      fetchImpl: fakeFetch,
    });
    assert.equal(result?.amountAud, 85);
    const messages = body.messages as Array<{ content: unknown }>;
    const parts = messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    assert.ok(parts.some((part) => part.image_url?.url.startsWith("data:image/jpeg;base64,")));
  });

  it("is off without a key, and can be turned off", () => {
    assert.equal(receiptAnalysisConfig({}), null);
    assert.ok(receiptAnalysisConfig({ OPENAI_API_KEY: "sk-test" }));
    assert.equal(receiptAnalysisConfig({ OPENAI_API_KEY: "sk-test", AI_EXPENSE_RECEIPTS_ENABLED: "false" }), null);
  });
});

describe("duplicates, limits and submitting", () => {
  it("matches the same shop, date and amount however the name is written", () => {
    assert.equal(vendorKey("SHELL Parramatta Pty Ltd"), vendorKey("shell  parramatta."));
    const a = expenseFingerprint({ vendor: "Bunnings Warehouse", date: "2026-11-24", amountAud: 45.5 });
    const b = expenseFingerprint({ vendor: "bunnings warehouse!", date: "2026-11-24", amountAud: 45.50 });
    assert.equal(a, b);
    assert.notEqual(a, expenseFingerprint({ vendor: "Bunnings Warehouse", date: "2026-11-25", amountAud: 45.5 }));
    assert.equal(expenseFingerprint({ vendor: "Bunnings", date: null, amountAud: 45.5 }), null);
  });

  it("flags amounts above the limit only", () => {
    assert.equal(isOverSpendingLimit(300, 300), false);
    assert.equal(isOverSpendingLimit(300.01, 300), true);
    assert.equal(isOverSpendingLimit(450, null), false);
  });

  it("never approves on submit: no receipt means incomplete, otherwise pending", () => {
    const noReceipt = missingExpenseFields({ vendor: "Parking", date: "2026-11-24", amountAud: 12, receipt: null });
    assert.deepEqual(noReceipt, ["receipt"]);
    assert.equal(statusAfterSubmit(noReceipt), "incomplete");
    assert.equal(statusAfterSubmit([]), "pending");
    assert.deepEqual(
      missingExpenseFields({ vendor: "", date: "bad", amountAud: 0, receipt: {} }),
      ["vendor", "date", "amount"],
    );
  });
});

describe("report periods", () => {
  it("weekly report on Mondays covers last Monday to Sunday", () => {
    assert.deepEqual(previousWeekPeriod("2026-11-30"), { kind: "week", start: "2026-11-23", end: "2026-11-29" });
    assert.deepEqual(reportsDueOn("2026-11-30", { weeklyReport: true, monthlyReport: true }).map((p) => p.kind), ["week"]);
    assert.deepEqual(reportsDueOn("2026-11-26", { weeklyReport: true, monthlyReport: true }), []);
  });

  it("monthly report on the 1st covers the whole previous month, across years", () => {
    assert.deepEqual(previousMonthPeriod("2026-12-01"), { kind: "month", start: "2026-11-01", end: "2026-11-30" });
    assert.deepEqual(previousMonthPeriod("2027-01-01"), { kind: "month", start: "2026-12-01", end: "2026-12-31" });
    assert.deepEqual(previousMonthPeriod("2028-03-01").end, "2028-02-29");
    // 1 Feb 2027 is a Monday: both reports are due.
    assert.deepEqual(reportsDueOn("2027-02-01", { weeklyReport: true, monthlyReport: true }).map((p) => p.kind), ["week", "month"]);
    assert.deepEqual(reportsDueOn("2027-02-01", { weeklyReport: false, monthlyReport: false }), []);
  });

  it("finds the week and month around any date", () => {
    assert.deepEqual(weekPeriodContaining("2026-11-26"), { kind: "week", start: "2026-11-23", end: "2026-11-29" });
    assert.deepEqual(monthPeriodContaining("2026-02-10"), { kind: "month", start: "2026-02-01", end: "2026-02-28" });
  });
});

describe("report totals and CSV", () => {
  const list = [
    expense({ id: "a", status: "approved", amountAud: 85, gstAud: 7.73, paidWith: "personal", reimbursement: { status: "owed", by: null, at: null, note: null } }),
    expense({ id: "b", status: "pending", amountAud: 450, gstAud: 40.91, category: "tools", overLimit: true, submittedBy: { uid: "sam", name: "Sam", role: "staff" } }),
    expense({ id: "c", status: "incomplete", amountAud: 12, gstAud: null, category: "parking_tolls", receipt: null, missing: ["receipt"] }),
    expense({ id: "d", status: "rejected", amountAud: 30, gstAud: 2.73 }),
    expense({ id: "e", status: "draft", amountAud: 99 }),
    expense({ id: "f", status: "approved", amountAud: 1000, date: "2026-10-31" }),
  ];

  it("adds up the period to the cent, leaving out rejected and drafts", () => {
    const summary = summarizeExpenses(list, { kind: "month", start: "2026-11-01", end: "2026-11-30" });
    assert.equal(summary.count, 4);
    assert.equal(summary.totalAud, 547);
    assert.equal(summary.gstAud, 48.64);
    assert.equal(summary.byStatus.rejected.totalAud, 30);
    assert.equal(summary.byStatus.approved.count, 1);
    assert.equal(summary.needsOwnerApproval.totalAud, 450);
    assert.equal(summary.missingReceipts, 1);
    assert.equal(summary.reimbursementOwed.totalAud, 85);
    assert.equal(summary.draftCount, 1);
    assert.equal(summary.byCategory[0].category, "tools");
    assert.deepEqual(summary.byPerson.map((person) => person.name), ["Sam", "Jo"]);
    assert.equal(summary.label, "November 2026");
  });

  it("writes a spreadsheet without drafts, grouped by status, safe from formulas", () => {
    const csv = expensesCsv([...list, expense({ id: "g", vendor: "=HYPERLINK(\"x\")", status: "pending" })]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 1 + 6);
    assert.match(lines[0], /^Code,Date,Shop or supplier/);
    assert.ok(lines[1].includes("Pending review"));
    assert.ok(!csv.includes(",=HYPERLINK"));
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell(12.5), "12.50");
  });
});

describe("expense settings", () => {
  it("defaults to a $300 limit with both reports on", () => {
    const settings = parseExpenseSettings(undefined);
    assert.equal(settings.spendingLimitAud, DEFAULT_SPENDING_LIMIT_AUD);
    assert.equal(settings.weeklyReport, true);
    assert.equal(settings.monthlyReport, true);
    assert.equal(parseExpenseSettings({ spendingLimitAud: null }).spendingLimitAud, null);
  });

  it("validates updates and gives new vehicles ids", () => {
    const current = parseExpenseSettings(undefined);
    const ok = normalizeExpenseSettingsPatch(
      { spendingLimitAud: "250", accountantEmail: " Books@Example.com ", vehicles: [{ name: "Van 1", rego: "abc123" }] },
      current,
    );
    assert.ok(ok.ok);
    if (ok.ok) {
      assert.equal(ok.value.spendingLimitAud, 250);
      assert.equal(ok.value.accountantEmail, "books@example.com");
      assert.equal(ok.value.vehicles[0].rego, "ABC123");
      assert.match(ok.value.vehicles[0].id, /^veh_/);
    }
    assert.equal(normalizeExpenseSettingsPatch({ accountantEmail: "nope" }, current).ok, false);
    assert.equal(normalizeExpenseSettingsPatch({ spendingLimitAud: -1 }, current).ok, false);
    assert.equal(normalizeExpenseSettingsPatch({ vehicles: [{ name: "" }] }, current).ok, false);
  });
});
