import "server-only";

import { resolveAppBaseUrl } from "@/lib/config/base-url";
import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import type { ExpenseReportSummary } from "@/lib/expenses/rules";
import { formatExpenseAud, type ExpenseRecord } from "@/lib/expenses/types";
import { notifyBusinessAdminsOfExpense } from "@/lib/notifications/server";
import { sendStaffMobilePush } from "@/lib/notifications/push";

/** Enough of the business to word an alert (see `ExpenseBusinessContext`). */
type BusinessForAlerts = {
  businessId: string;
  businessName: string | null;
  logoUrl: string | null;
  settings: { spendingLimitAud: number | null; accountantEmail: string | null };
};

function shortLabel(expense: ExpenseRecord): string {
  const vendor = expense.vendor ?? "an expense";
  return `${vendor} ${formatExpenseAud(expense.amountAud)}`;
}

async function pushToSubmitter(expense: ExpenseRecord, title: string, body: string, type: string) {
  if (!expense.submittedBy.uid) return;
  await sendStaffMobilePush({
    uid: expense.submittedBy.uid,
    title,
    body,
    // requestId too: the app's foreground notifications carry only that id.
    data: { type, expenseId: expense.id, requestId: expense.id, audience: "staff" },
  });
}

/** An expense above the spending limit was submitted: the owner decides. */
export async function notifyOwnerExpenseNeedsApproval(
  business: BusinessForAlerts,
  expense: ExpenseRecord,
): Promise<void> {
  const limit = business.settings.spendingLimitAud;
  await notifyBusinessAdminsOfExpense({
    businessId: business.businessId,
    targetId: expense.id,
    type: "expense_approval_needed",
    title: "Expense needs your approval",
    body: `${expense.submittedBy.name} submitted ${shortLabel(expense)} (${expense.expenseCode})${
      limit != null ? `, over your ${formatExpenseAud(limit)} limit` : ""
    }. Approve or reject it in Expenses.`,
  });
}

export async function notifyStaffExpenseDecision(expense: ExpenseRecord): Promise<void> {
  const approved = expense.status === "approved";
  const owed = approved && expense.reimbursement.status === "owed";
  await pushToSubmitter(
    expense,
    approved ? "Expense approved" : "Expense rejected",
    approved
      ? `${expense.expenseCode} (${shortLabel(expense)}) was approved${owed ? ". Your reimbursement will be arranged by the owner or accounts." : "."}`
      : `${expense.expenseCode} (${shortLabel(expense)}) was rejected${expense.decision?.note ? `: ${expense.decision.note}` : "."}`,
    approved ? "expense_approved" : "expense_rejected",
  );
}

export async function notifyStaffReceiptRequested(expense: ExpenseRecord): Promise<void> {
  const note = expense.receiptRequest?.note;
  await pushToSubmitter(
    expense,
    "Receipt needed",
    `Please add the receipt for ${expense.expenseCode} (${shortLabel(expense)})${note ? `: ${note}` : "."}`,
    "expense_receipt_requested",
  );
}

export async function notifyStaffExpenseReimbursed(expense: ExpenseRecord): Promise<void> {
  await pushToSubmitter(
    expense,
    "Reimbursement recorded",
    `${expense.reimbursement.by?.name ?? "The owner"} recorded your reimbursement for ${expense.expenseCode} (${shortLabel(expense)}).`,
    "expense_reimbursed",
  );
}

/**
 * Sophie's follow-up on an incomplete expense: the receipt is missing, or
 * the owner asked for a clearer receipt or more details.
 */
export async function remindStaffMissingReceipt(expense: ExpenseRecord): Promise<void> {
  const asker = expense.receiptRequest?.requestedBy?.name;
  await pushToSubmitter(
    expense,
    expense.receipt ? "Expense needs another look" : "Receipt still needed",
    expense.receipt
      ? `Sophie here: ${asker ?? "the owner"} asked about ${expense.expenseCode} (${shortLabel(expense)})${
          expense.receiptRequest?.note ? `: ${expense.receiptRequest.note}` : ""
        }. Update it in Expenses.`
      : `Sophie here: the receipt for ${expense.expenseCode} (${shortLabel(expense)}) is still missing. Snap a photo of it in Expenses.`,
    "expense_receipt_reminder",
  );
}

/** Sophie's nudge for a draft nobody submitted. */
export async function remindStaffUnsubmittedDraft(expense: ExpenseRecord): Promise<void> {
  await pushToSubmitter(
    expense,
    "Expense draft to finish",
    `Sophie here: ${expense.expenseCode} (${shortLabel(expense)}) is still a draft. Check it and submit it in Expenses.`,
    "expense_draft_reminder",
  );
}

function reportRows(summary: ExpenseReportSummary): EmailDetailRow[] {
  const rows: EmailDetailRow[] = [
    { label: "Total (excl. rejected)", value: `${formatExpenseAud(summary.totalAud)} · ${summary.count} expense${summary.count === 1 ? "" : "s"}` },
    { label: "GST", value: formatExpenseAud(summary.gstAud) },
    { label: "Approved", value: `${formatExpenseAud(summary.byStatus.approved.totalAud)} · ${summary.byStatus.approved.count}` },
    { label: "Pending review", value: `${formatExpenseAud(summary.byStatus.pending.totalAud)} · ${summary.byStatus.pending.count}` },
    { label: "Incomplete", value: `${summary.byStatus.incomplete.count}${summary.missingReceipts ? ` (${summary.missingReceipts} missing a receipt)` : ""}` },
    { label: "Rejected", value: `${formatExpenseAud(summary.byStatus.rejected.totalAud)} · ${summary.byStatus.rejected.count}` },
  ];
  if (summary.needsOwnerApproval.count) {
    rows.push({
      label: "Over the limit, waiting for the owner",
      value: `${formatExpenseAud(summary.needsOwnerApproval.totalAud)} · ${summary.needsOwnerApproval.count}`,
    });
  }
  if (summary.reimbursementOwed.count) {
    rows.push({
      label: "Reimbursements owed to staff",
      value: `${formatExpenseAud(summary.reimbursementOwed.totalAud)} · ${summary.reimbursementOwed.count}`,
    });
  }
  for (const category of summary.byCategory.slice(0, 5)) {
    rows.push({ label: category.label, value: `${formatExpenseAud(category.totalAud)} · ${category.count}` });
  }
  return rows;
}

/**
 * A weekly or monthly report is ready: the owner gets an alert, and the
 * owner and the accountant get the report by email with a CSV attached.
 */
export async function sendExpenseReport(input: {
  business: BusinessForAlerts;
  reportId: string;
  summary: ExpenseReportSummary;
  csv: string;
  ownerEmail: string | null;
}): Promise<string[]> {
  const { business, summary } = input;
  const kind = summary.period.kind === "week" ? "Weekly" : "Monthly";
  await notifyBusinessAdminsOfExpense({
    businessId: business.businessId,
    targetId: input.reportId,
    type: "expense_report_ready",
    title: `${kind} expense report ready`,
    body: `${summary.label}: ${formatExpenseAud(summary.totalAud)} across ${summary.count} expense${summary.count === 1 ? "" : "s"}${
      summary.byStatus.pending.count ? `, ${summary.byStatus.pending.count} waiting for review` : ""
    }.`,
  });

  const baseUrl = resolveAppBaseUrl();
  const recipients = [...new Set([input.ownerEmail, business.settings.accountantEmail]
    .map((email) => email?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email)))];
  const sent: string[] = [];
  const fileName = `expenses-${summary.period.kind}-${summary.period.start}.csv`;
  for (const to of recipients) {
    const forAccountant = to === business.settings.accountantEmail && to !== input.ownerEmail?.trim().toLowerCase();
    const html = renderEmail({
      eyebrow: "Expenses",
      tone: "brand",
      title: `${kind} expense report`,
      body: `${summary.label}.\n\nSophie prepared this summary from the receipts your team submitted. The attached spreadsheet lists every expense with its status. Approvals and reimbursements are handled by the owner or accounts team.`,
      details: reportRows(summary),
      ...(baseUrl && !forAccountant
        ? { ctaUrl: `${baseUrl}/dashboard/expenses?tab=reports`, ctaLabel: "Open expenses" }
        : {}),
      footnote: forAccountant
        ? `You get this report because ${business.businessName ?? "the business"} added you as their accountant.`
        : "Change who gets this report in Expenses → Settings.",
      businessName: business.businessName,
      logoUrl: business.logoUrl,
    });
    const ok = await sendEmail({
      sender: "sophie",
      to,
      subject: `${business.businessName ? `${business.businessName}: ` : ""}${kind} expense report (${summary.label})`,
      htmlBody: html,
      attachments: [{ content: Buffer.from(input.csv, "utf8").toString("base64"), mimeType: "text/csv", name: fileName }],
    });
    if (ok) sent.push(forAccountant ? "accountant" : "owner");
  }
  return sent;
}
