/**
 * Expense rules with no Firestore or network access, so they can be tested:
 * duplicate fingerprints, spending limits, what is missing, report periods,
 * report totals and the CSV export.
 */

import {
  ACCOUNTANT_STATUS_ORDER,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_STATUSES,
  EXPENSE_STATUS_LABELS,
  type ExpenseCategory,
  type ExpenseMissingField,
  type ExpenseRecord,
  type ExpenseStatus,
} from "@/lib/expenses/types";

export const roundCents = (value: number) => Math.round(value * 100) / 100;
const cents = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? Math.round(value * 100) : 0;
const fromCents = (value: number) => value / 100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Shop name reduced to letters and digits, so "SHELL Parramatta" and "Shell  parramatta." match. */
export function vendorKey(vendor: string | null | undefined): string {
  return (vendor ?? "")
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|co|the)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

/**
 * Same shop, same day, same amount: almost always the same receipt uploaded
 * twice (a second photo of one receipt has different bytes, so the image
 * hash alone does not catch it). Null until all three are known.
 */
export function expenseFingerprint(input: {
  vendor: string | null;
  date: string | null;
  amountAud: number | null;
}): string | null {
  const vendor = vendorKey(input.vendor);
  if (!vendor || !isIsoDate(input.date) || input.amountAud == null || !(input.amountAud > 0)) return null;
  return `${vendor}|${input.date}|${cents(input.amountAud)}`;
}

/** Details a submitted expense still needs. A receipt is always expected. */
export function missingExpenseFields(expense: {
  vendor: string | null;
  date: string | null;
  amountAud: number | null;
  receipt: unknown;
}): ExpenseMissingField[] {
  const missing: ExpenseMissingField[] = [];
  if (!expense.receipt) missing.push("receipt");
  if (!expense.vendor?.trim()) missing.push("vendor");
  if (!isIsoDate(expense.date)) missing.push("date");
  if (expense.amountAud == null || !(expense.amountAud > 0)) missing.push("amount");
  return missing;
}

export function isOverSpendingLimit(amountAud: number | null, limitAud: number | null): boolean {
  if (amountAud == null || limitAud == null) return false;
  return cents(amountAud) > cents(limitAud);
}

/**
 * Where a submitted expense goes. Without a receipt it is incomplete (Sophie
 * asks for it); otherwise it waits for a person to review it. Nothing is
 * approved automatically.
 */
export function statusAfterSubmit(missing: ExpenseMissingField[]): ExpenseStatus {
  return missing.includes("receipt") ? "incomplete" : "pending";
}

// ---------------------------------------------------------------------------
// Dates and report periods (all dates are business-local `YYYY-MM-DD`)
// ---------------------------------------------------------------------------

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const day = toUtc(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

export type ExpenseReportPeriod = {
  kind: "week" | "month";
  start: string;
  end: string;
};

/** Monday to Sunday of the week before the one [todayIso] is in. */
export function previousWeekPeriod(todayIso: string): ExpenseReportPeriod {
  const thisMonday = addDaysIso(todayIso, 1 - isoWeekday(todayIso));
  return { kind: "week", start: addDaysIso(thisMonday, -7), end: addDaysIso(thisMonday, -1) };
}

/** The whole calendar month before the one [todayIso] is in. */
export function previousMonthPeriod(todayIso: string): ExpenseReportPeriod {
  const [y, m] = todayIso.split("-").map(Number);
  const firstOfThisMonth = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = addDaysIso(firstOfThisMonth, -1);
  return { kind: "month", start: `${end.slice(0, 7)}-01`, end };
}

export function weekPeriodContaining(iso: string): ExpenseReportPeriod {
  const start = addDaysIso(iso, 1 - isoWeekday(iso));
  return { kind: "week", start, end: addDaysIso(start, 6) };
}

export function monthPeriodContaining(iso: string): ExpenseReportPeriod {
  const start = `${iso.slice(0, 7)}-01`;
  const [y, m] = iso.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { kind: "month", start, end: addDaysIso(nextMonth, -1) };
}

/** Reports due on [todayIso]: the weekly one on Mondays, the monthly one on the 1st. */
export function reportsDueOn(
  todayIso: string,
  settings: { weeklyReport: boolean; monthlyReport: boolean },
): ExpenseReportPeriod[] {
  const due: ExpenseReportPeriod[] = [];
  if (settings.weeklyReport && isoWeekday(todayIso) === 1) due.push(previousWeekPeriod(todayIso));
  if (settings.monthlyReport && todayIso.endsWith("-01")) due.push(previousMonthPeriod(todayIso));
  return due;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });

export function periodLabel(period: ExpenseReportPeriod): string {
  if (period.kind === "month") return MONTH_YEAR.format(toUtc(period.start));
  return `Week of ${DAY_MONTH.format(toUtc(period.start))} – ${DAY_MONTH_YEAR.format(toUtc(period.end))}`;
}

export function formatExpenseDate(iso: string | null): string {
  return iso && isIsoDate(iso) ? DAY_MONTH_YEAR.format(toUtc(iso)) : "No date";
}

export function reportId(businessId: string, period: ExpenseReportPeriod): string {
  return `${businessId}_${period.kind}_${period.start}`;
}

// ---------------------------------------------------------------------------
// Report totals
// ---------------------------------------------------------------------------

export type ExpenseTotals = { count: number; totalAud: number };

export type ExpenseReportSummary = {
  period: ExpenseReportPeriod;
  label: string;
  /** Submitted expenses in the period (drafts are still with the submitter). */
  count: number;
  /** Everything not rejected: approved, pending and incomplete. */
  totalAud: number;
  gstAud: number;
  byStatus: Record<ExpenseStatus, ExpenseTotals>;
  byCategory: Array<ExpenseTotals & { category: ExpenseCategory; label: string }>;
  byPerson: Array<ExpenseTotals & { uid: string; name: string }>;
  needsOwnerApproval: ExpenseTotals;
  missingReceipts: number;
  reimbursementOwed: ExpenseTotals;
  draftCount: number;
};

function addTo(totals: { count: number; cents: number }, amount: number | null) {
  totals.count += 1;
  totals.cents += cents(amount);
}

/** Totals for the expenses dated within [period] (inclusive). */
export function summarizeExpenses(
  expenses: ExpenseRecord[],
  period: ExpenseReportPeriod,
): ExpenseReportSummary {
  const inPeriod = expenses.filter(
    (expense) => expense.date != null && expense.date >= period.start && expense.date <= period.end,
  );
  const submitted = inPeriod.filter((expense) => expense.status !== "draft");

  const byStatus = Object.fromEntries(
    EXPENSE_STATUSES.map((status) => [status, { count: 0, cents: 0 }]),
  ) as Record<ExpenseStatus, { count: number; cents: number }>;
  const byCategory = new Map<ExpenseCategory, { count: number; cents: number }>();
  const byPerson = new Map<string, { name: string; count: number; cents: number }>();
  const approval = { count: 0, cents: 0 };
  const owed = { count: 0, cents: 0 };
  let totalCents = 0;
  let gstCents = 0;
  let missingReceipts = 0;

  for (const expense of inPeriod) addTo(byStatus[expense.status], expense.amountAud);

  for (const expense of submitted) {
    if (expense.status === "rejected") continue;
    totalCents += cents(expense.amountAud);
    gstCents += cents(expense.gstAud);
    const category = byCategory.get(expense.category) ?? { count: 0, cents: 0 };
    addTo(category, expense.amountAud);
    byCategory.set(expense.category, category);
    const person = byPerson.get(expense.submittedBy.uid) ?? { name: expense.submittedBy.name, count: 0, cents: 0 };
    addTo(person, expense.amountAud);
    byPerson.set(expense.submittedBy.uid, person);
    if (expense.status === "pending" && expense.overLimit) addTo(approval, expense.amountAud);
    if (expense.status === "incomplete" && expense.missing.includes("receipt")) missingReceipts += 1;
    if (expense.status === "approved" && expense.reimbursement.status === "owed") addTo(owed, expense.amountAud);
  }

  const totals = (value: { count: number; cents: number }): ExpenseTotals => ({
    count: value.count,
    totalAud: fromCents(value.cents),
  });

  return {
    period,
    label: periodLabel(period),
    count: submitted.length,
    totalAud: fromCents(totalCents),
    gstAud: fromCents(gstCents),
    byStatus: Object.fromEntries(
      EXPENSE_STATUSES.map((status) => [status, totals(byStatus[status])]),
    ) as Record<ExpenseStatus, ExpenseTotals>,
    byCategory: EXPENSE_CATEGORIES.filter((category) => byCategory.has(category))
      .map((category) => ({
        category,
        label: EXPENSE_CATEGORY_LABELS[category],
        ...totals(byCategory.get(category)!),
      }))
      .sort((a, b) => b.totalAud - a.totalAud),
    byPerson: [...byPerson.entries()]
      .map(([uid, value]) => ({ uid, name: value.name, ...totals(value) }))
      .sort((a, b) => b.totalAud - a.totalAud),
    needsOwnerApproval: totals(approval),
    missingReceipts,
    reimbursementOwed: totals(owed),
    draftCount: byStatus.draft.count,
  };
}

// ---------------------------------------------------------------------------
// CSV export (for the accountant)
// ---------------------------------------------------------------------------

/** Quotes a CSV cell and stops spreadsheet formulas (`=`, `+`, `-`, `@`) running. */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  let text = typeof value === "number" ? value.toFixed(2) : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_HEADER = [
  "Code",
  "Date",
  "Shop or supplier",
  "Category",
  "Reason",
  "Amount (AUD, incl. GST)",
  "GST (AUD)",
  "Status",
  "Submitted by",
  "Paid with",
  "Reimbursement",
  "Job",
  "Vehicle",
  "Over spending limit",
  "Receipt attached",
  "Decided by",
  "Decision note",
];

const STATUS_SORT = new Map(ACCOUNTANT_STATUS_ORDER.map((status, index) => [status, index]));

export function expensesCsv(expenses: ExpenseRecord[]): string {
  const rows = [...expenses]
    .filter((expense) => expense.status !== "draft")
    .sort(
      (a, b) =>
        (STATUS_SORT.get(a.status) ?? 9) - (STATUS_SORT.get(b.status) ?? 9) ||
        (a.date ?? "").localeCompare(b.date ?? "") ||
        a.expenseCode.localeCompare(b.expenseCode),
    )
    .map((expense) => [
      expense.expenseCode,
      expense.date,
      expense.vendor,
      EXPENSE_CATEGORY_LABELS[expense.category],
      expense.reason,
      expense.amountAud,
      expense.gstAud,
      EXPENSE_STATUS_LABELS[expense.status],
      expense.submittedBy.name,
      expense.paidWith === "personal" ? "Own money" : "Business",
      expense.reimbursement.status === "owed"
        ? "Owed"
        : expense.reimbursement.status === "reimbursed"
          ? "Reimbursed"
          : "",
      expense.jobLabel,
      expense.vehicleLabel,
      expense.overLimit ? "Yes" : "No",
      expense.receipt ? "Yes" : "No",
      expense.decision?.by.name ?? null,
      expense.decision?.note ?? null,
    ]);
  return [CSV_HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
