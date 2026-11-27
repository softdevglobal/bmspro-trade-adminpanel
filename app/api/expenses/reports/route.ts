import { buildExpenseReport, listStoredExpenseReports } from "@/lib/expenses/reports.server";
import { jsonError, requireExpenseAccess } from "@/lib/expenses/route-auth";
import { isIsoDate, monthPeriodContaining, weekPeriodContaining } from "@/lib/expenses/rules";
import { isExpenseManager } from "@/lib/expenses/server";
import { platformTodayIso } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Owner/admin only.
 * GET /api/expenses/reports                                  the weekly and monthly reports Sophie made
 * GET /api/expenses/reports?kind=week|month&date=YYYY-MM-DD  a live summary of that week or month
 *     …&format=csv                                           the same period as a spreadsheet
 */
export async function GET(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  const { actor, business } = access;
  if (!isExpenseManager(actor)) return jsonError(403, "Only the owner or an admin can see expense reports.");

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  try {
    if (kind !== "week" && kind !== "month") {
      const reports = await listStoredExpenseReports(actor.businessId);
      return NextResponse.json({ ok: true, reports });
    }
    const dateParam = params.get("date") ?? "";
    const date = isIsoDate(dateParam) ? dateParam : platformTodayIso(new Date(), business.timeZone);
    const period = kind === "week" ? weekPeriodContaining(date) : monthPeriodContaining(date);
    const report = await buildExpenseReport(actor.businessId, period);
    if (params.get("format") === "csv") {
      return new Response(report.csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="expenses-${period.kind}-${period.start}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ ok: true, summary: report.summary });
  } catch (error) {
    console.error("[expenses] report failed", error instanceof Error ? error.message : "unknown");
    return jsonError(500, "Could not build the expense report.");
  }
}
