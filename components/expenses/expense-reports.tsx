"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { downloadExpenseCsv, expenseRequest } from "@/lib/expenses/client";
import {
  addDaysIso,
  formatExpenseDate,
  monthPeriodContaining,
  summarizeExpenses,
  weekPeriodContaining,
  type ExpenseReportSummary,
} from "@/lib/expenses/rules";
import {
  ACCOUNTANT_STATUS_ORDER,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_STATUS_LABELS,
  formatExpenseAud,
  type ExpenseRecord,
  type ExpenseStatus,
} from "@/lib/expenses/types";
import { useEffect, useMemo, useState } from "react";

type StoredReport = {
  id: string;
  kind: "week" | "month";
  start: string;
  label: string;
  summary: ExpenseReportSummary;
  emailedTo: string[];
  createdAt: number | null;
};

const GROUP_STYLE: Record<ExpenseStatus, { icon: string; tone: string }> = {
  pending: { icon: "hourglass_top", tone: "text-amber-700" },
  incomplete: { icon: "assignment_late", tone: "text-orange-700" },
  approved: { icon: "check_circle", tone: "text-tertiary" },
  rejected: { icon: "cancel", tone: "text-error" },
  draft: { icon: "edit_note", tone: "text-on-surface-variant" },
};

function shiftMonth(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function ExpenseReports({
  expenses,
  todayIso,
  onOpen,
}: {
  expenses: ExpenseRecord[];
  todayIso: string;
  onOpen: (expense: ExpenseRecord) => void;
}) {
  const { user } = useAuth();
  const [kind, setKind] = useState<"week" | "month">("month");
  const [anchor, setAnchor] = useState(todayIso);
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await expenseRequest<{ reports: StoredReport[] }>(user, "/api/expenses/reports");
        if (!cancelled) setReports(result.reports);
      } catch (error) {
        if (!cancelled) setReportsError(error instanceof Error ? error.message : "Could not load reports.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const period = useMemo(
    () => (kind === "week" ? weekPeriodContaining(anchor) : monthPeriodContaining(anchor)),
    [kind, anchor],
  );
  const summary = useMemo(() => summarizeExpenses(expenses, period), [expenses, period]);
  const groups = useMemo(() => {
    const inPeriod = expenses.filter(
      (expense) => expense.date != null && expense.date >= period.start && expense.date <= period.end,
    );
    return ACCOUNTANT_STATUS_ORDER.map((status) => ({
      status,
      items: inPeriod
        .filter((expense) => expense.status === status)
        .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    }));
  }, [expenses, period]);

  const isCurrent = kind === "week"
    ? period.end >= todayIso
    : period.start === monthPeriodContaining(todayIso).start;

  function move(step: number) {
    setAnchor((current) => (kind === "week" ? addDaysIso(current, step * 7) : shiftMonth(current, step)));
  }

  async function download() {
    if (!user) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadExpenseCsv(user, kind, period.start);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Could not download.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="font-display text-[16px] font-semibold text-on-surface">Accountant overview</h3>
          <p className="font-body text-[13px] text-on-surface-variant">
            Every expense in the period, grouped for review. Download the spreadsheet for your accountant.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-outline-variant/70 bg-surface-container-low p-0.5">
            {(["week", "month"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`rounded-lg px-3 py-1.5 font-body text-[13px] font-semibold ${
                  kind === value ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {value === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1">
            <button type="button" aria-label="Previous period" onClick={() => move(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/70 hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <span className="min-w-[180px] text-center font-body text-[13px] font-semibold text-on-surface">{summary.label}</span>
            <button type="button" aria-label="Next period" disabled={isCurrent} onClick={() => move(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant/70 hover:bg-surface-container-high disabled:opacity-40">
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 font-body text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            {downloading ? "Preparing…" : "Download spreadsheet"}
          </button>
        </div>
      </div>
      {downloadError ? <p className="font-body text-[13px] text-error">{downloadError}</p> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Total (excl. rejected)" value={formatExpenseAud(summary.totalAud)} hint={`${summary.count} expense${summary.count === 1 ? "" : "s"} · GST ${formatExpenseAud(summary.gstAud)}`} />
        <SummaryTile label="Approved" value={formatExpenseAud(summary.byStatus.approved.totalAud)} hint={`${summary.byStatus.approved.count} approved`} />
        <SummaryTile
          label="Waiting for review"
          value={formatExpenseAud(summary.byStatus.pending.totalAud)}
          hint={summary.needsOwnerApproval.count ? `${summary.needsOwnerApproval.count} over the limit` : `${summary.byStatus.pending.count} pending`}
        />
        <SummaryTile
          label="Owed to staff"
          value={formatExpenseAud(summary.reimbursementOwed.totalAud)}
          hint={`${summary.reimbursementOwed.count} to reimburse`}
        />
      </div>

      {summary.byCategory.length ? (
        <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4">
          <p className="mb-2 font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">By category</p>
          <div className="flex flex-wrap gap-2">
            {summary.byCategory.map((row) => (
              <span key={row.category} className="rounded-full border border-outline-variant/60 bg-surface-container-low px-3 py-1 font-body text-[12px] text-on-surface">
                {row.label} <strong>{formatExpenseAud(row.totalAud)}</strong> · {row.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {groups.map((group) => (
          <section key={group.status} className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest">
            <header className="flex items-center justify-between border-b border-outline-variant/50 px-4 py-2.5">
              <p className={`flex items-center gap-1.5 font-body text-[14px] font-semibold ${GROUP_STYLE[group.status].tone}`}>
                <span className="material-symbols-outlined text-[18px]">{GROUP_STYLE[group.status].icon}</span>
                {EXPENSE_STATUS_LABELS[group.status]}
              </p>
              <p className="font-body text-[13px] text-on-surface-variant">
                {group.items.length} · {formatExpenseAud(summary.byStatus[group.status].totalAud)}
              </p>
            </header>
            {group.items.length ? (
              <ul className="divide-y divide-outline-variant/40">
                {group.items.map((expense) => (
                  <li key={expense.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(expense)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-container-low"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-[13px] font-semibold text-on-surface">
                          {expense.vendor ?? "No shop"} <span className="font-normal text-on-surface-variant">· {expense.expenseCode}</span>
                        </p>
                        <p className="truncate font-body text-[12px] text-on-surface-variant">
                          {formatExpenseDate(expense.date)} · {EXPENSE_CATEGORY_LABELS[expense.category]} · {expense.submittedBy.name}
                          {!expense.receipt ? " · no receipt" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 font-body text-[13px] font-semibold tabular-nums text-on-surface">
                        {formatExpenseAud(expense.amountAud)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 font-body text-[13px] text-on-surface-variant">None in this period.</p>
            )}
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4">
        <h3 className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-on-surface">
          <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
          Reports from Sophie
        </h3>
        <p className="font-body text-[13px] text-on-surface-variant">
          Every Monday (last week) and on the 1st (last month), Sophie emails a summary with the spreadsheet to you and your accountant.
        </p>
        {reportsError ? <p className="mt-2 font-body text-[13px] text-error">{reportsError}</p> : null}
        {reports.length ? (
          <ul className="mt-3 divide-y divide-outline-variant/40">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-body text-[13px] font-semibold text-on-surface">
                    {report.kind === "week" ? "Weekly" : "Monthly"} · {report.label}
                  </p>
                  <p className="font-body text-[12px] text-on-surface-variant">
                    {formatExpenseAud(report.summary.totalAud)} · {report.summary.count} expenses · {report.summary.byStatus.pending.count} pending ·{" "}
                    {report.emailedTo.length ? `emailed to ${report.emailedTo.join(" and ")}` : "not emailed"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setKind(report.kind);
                    setAnchor(report.start);
                  }}
                  className="inline-flex h-8 items-center rounded-lg border border-outline-variant px-3 font-body text-[12px] font-semibold text-on-surface hover:bg-surface-container-high"
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 font-body text-[13px] text-on-surface-variant">No reports yet. The first one arrives after a week with submitted expenses.</p>
        )}
      </section>

      {summary.draftCount ? (
        <p className="font-body text-[12px] text-on-surface-variant">
          {summary.draftCount} draft{summary.draftCount === 1 ? " is" : "s are"} not counted until submitted.
        </p>
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-1 font-display text-[1.35rem] font-semibold leading-tight text-on-surface">{value}</p>
      <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">{hint}</p>
    </div>
  );
}
