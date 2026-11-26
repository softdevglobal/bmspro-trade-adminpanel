import { runAllDueExpenseReports, sendExpenseReminders } from "@/lib/expenses/reports.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily, early morning in Australia. Sophie's expense follow-ups:
 *   - the weekly report on Mondays and the monthly report on the 1st
 *     (business-local dates; a report is only made once),
 *   - reminders about missing receipts and unsubmitted drafts.
 * No approvals or payments happen here.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const now = new Date();
  let reports = 0;
  let reminders = { receipts: 0, drafts: 0 };
  let failed = false;
  try {
    reports = await runAllDueExpenseReports(now);
  } catch {
    failed = true;
    console.error("[cron/expenses] reports failed");
  }
  try {
    reminders = await sendExpenseReminders(now);
  } catch {
    failed = true;
    console.error("[cron/expenses] reminders failed");
  }
  return Response.json({ ok: !failed, reports, reminders }, { status: failed ? 500 : 200 });
}
