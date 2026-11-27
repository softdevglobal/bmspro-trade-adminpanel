import "server-only";

import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

import {
  remindStaffMissingReceipt,
  remindStaffUnsubmittedDraft,
  sendExpenseReport,
} from "@/lib/expenses/notify";
import {
  expensesCsv,
  reportId,
  reportsDueOn,
  summarizeExpenses,
  type ExpenseReportPeriod,
  type ExpenseReportSummary,
} from "@/lib/expenses/rules";
import {
  businessContextFromDoc,
  listBusinessExpenses,
  loadExpenseBusiness,
  mapExpenseDoc,
  type ExpenseBusinessContext,
} from "@/lib/expenses/server";
import { EXPENSE_COLLECTION, EXPENSE_REPORT_COLLECTION, type ExpenseRecord } from "@/lib/expenses/types";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { platformTodayIso } from "@/lib/platform/timezone";

const DAY_MS = 86_400_000;
/** Sophie reminds about a missing receipt every two days, three times at most. */
export const RECEIPT_REMINDER_GAP_MS = 2 * DAY_MS;
export const MAX_RECEIPT_REMINDERS = 3;
/** Drafts left this long get one nudge. */
export const DRAFT_REMINDER_AFTER_MS = 3 * DAY_MS;

export type StoredExpenseReport = {
  id: string;
  kind: "week" | "month";
  start: string;
  end: string;
  label: string;
  summary: ExpenseReportSummary;
  emailedTo: string[];
  createdAt: number | null;
};

export async function buildExpenseReport(
  businessId: string,
  period: ExpenseReportPeriod,
): Promise<{ summary: ExpenseReportSummary; expenses: ExpenseRecord[]; csv: string }> {
  const all = await listBusinessExpenses(businessId);
  const expenses = all.filter(
    (expense) => expense.date != null && expense.date >= period.start && expense.date <= period.end,
  );
  return { summary: summarizeExpenses(all, period), expenses, csv: expensesCsv(expenses) };
}

export async function listStoredExpenseReports(businessId: string): Promise<StoredExpenseReport[]> {
  const snapshot = await adminDb
    .collection(EXPENSE_REPORT_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(120)
    .get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        kind: data.kind === "month" ? ("month" as const) : ("week" as const),
        start: String(data.start ?? ""),
        end: String(data.end ?? ""),
        label: String(data.label ?? ""),
        summary: data.summary as ExpenseReportSummary,
        emailedTo: Array.isArray(data.emailedTo) ? data.emailedTo.map(String) : [],
        createdAt: typeof data.createdAt === "number" ? data.createdAt : null,
      };
    })
    .filter((report) => report.summary && report.start)
    .sort((a, b) => b.start.localeCompare(a.start) || a.kind.localeCompare(b.kind));
}

async function ownerEmailFor(business: ExpenseBusinessContext): Promise<string | null> {
  if (!business.ownerUid) return null;
  try {
    return (await adminAuth.getUser(business.ownerUid)).email?.trim() || null;
  } catch {
    return null;
  }
}

/** Creates and sends the reports due today for one business. Safe to run more than once a day. */
export async function runDueExpenseReports(
  business: ExpenseBusinessContext,
  now: Date,
): Promise<number> {
  if (!business.expensesEnabled) return 0;
  const todayIso = platformTodayIso(now, business.timeZone);
  const due = reportsDueOn(todayIso, business.settings);
  if (!due.length) return 0;

  let all: ExpenseRecord[] | null = null;
  let created = 0;
  for (const period of due) {
    const id = reportId(business.businessId, period);
    const ref = adminDb.collection(EXPENSE_REPORT_COLLECTION).doc(id);
    if ((await ref.get()).exists) continue;
    all ??= await listBusinessExpenses(business.businessId);
    const summary = summarizeExpenses(all, period);
    if (summary.count === 0) continue; // nothing submitted: no report to send
    try {
      // create() fails if another run already made this report.
      await ref.create({
        businessId: business.businessId,
        kind: period.kind,
        start: period.start,
        end: period.end,
        label: summary.label,
        summary,
        emailedTo: [],
        createdAt: Date.now(),
      });
    } catch {
      continue;
    }
    const inPeriod = all.filter(
      (expense) => expense.date != null && expense.date >= period.start && expense.date <= period.end,
    );
    const emailedTo = await sendExpenseReport({
      business,
      reportId: id,
      summary,
      csv: expensesCsv(inPeriod),
      ownerEmail: await ownerEmailFor(business),
    });
    await ref.update({ emailedTo });
    created += 1;
  }
  return created;
}

/**
 * Sophie's daily follow-ups: reminds people about missing receipts (every
 * two days, three times at most) and about drafts left for three days.
 */
export async function sendExpenseReminders(now: Date): Promise<{ receipts: number; drafts: number }> {
  const businesses = new Map<string, Promise<ExpenseBusinessContext | null>>();
  const enabled = (businessId: string) => {
    if (!businesses.has(businessId)) businesses.set(businessId, loadExpenseBusiness(businessId).catch(() => null));
    return businesses.get(businessId)!.then((business) => business?.expensesEnabled === true);
  };
  const nowMs = now.getTime();
  let receipts = 0;
  let drafts = 0;

  const incomplete = adminDb.collection(EXPENSE_COLLECTION).where("status", "==", "incomplete");
  for await (const doc of incomplete.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const expense = mapExpenseDoc(doc.id, doc.data());
    const request = expense.receiptRequest;
    if (!request || request.remindersSent >= MAX_RECEIPT_REMINDERS) continue;
    if (request.lastReminderAt != null && nowMs - request.lastReminderAt < RECEIPT_REMINDER_GAP_MS) continue;
    if (!(await enabled(expense.businessId))) continue;
    await doc.ref.update({
      "receiptRequest.remindersSent": request.remindersSent + 1,
      "receiptRequest.lastReminderAt": nowMs,
    });
    await remindStaffMissingReceipt(expense);
    receipts += 1;
  }

  const draftQuery = adminDb.collection(EXPENSE_COLLECTION).where("status", "==", "draft");
  for await (const doc of draftQuery.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const data = doc.data();
    if (typeof data.draftReminderAt === "number") continue;
    const expense = mapExpenseDoc(doc.id, data);
    if (expense.createdAt == null || nowMs - expense.createdAt < DRAFT_REMINDER_AFTER_MS) continue;
    if (!(await enabled(expense.businessId))) continue;
    await doc.ref.update({ draftReminderAt: nowMs });
    await remindStaffUnsubmittedDraft(expense);
    drafts += 1;
  }

  return { receipts, drafts };
}

/** Runs the reports due today for every business with Expenses turned on. */
export async function runAllDueExpenseReports(now: Date): Promise<number> {
  const query = adminDb
    .collection("businesses")
    .select("enabledModules", "expenseSettings", "timezone", "businessName", "ownerUid", "logoUrl");
  let created = 0;
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const business = businessContextFromDoc(doc.id, doc.data());
    if (!business.expensesEnabled) continue;
    try {
      created += await runDueExpenseReports(business, now);
    } catch {
      console.error("[expenses] report failed for a business");
    }
  }
  return created;
}
