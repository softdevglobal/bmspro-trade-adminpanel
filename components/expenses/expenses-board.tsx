"use client";

import {
  ActionButton,
  DuplicateDialog,
  ExpenseDrawer,
  ExpenseStatusBadge,
} from "@/components/expenses/expense-drawer";
import { ExpenseReports } from "@/components/expenses/expense-reports";
import { ExpenseSettingsPanel } from "@/components/expenses/expense-settings";
import { useAuth } from "@/lib/auth/auth-context";
import {
  ExpenseApiError,
  expenseRequest,
  uploadReceipt,
  type ExpenseOptions,
} from "@/lib/expenses/client";
import { formatExpenseDate } from "@/lib/expenses/rules";
import {
  EXPENSE_CATEGORY_LABELS,
  formatExpenseAud,
  type ExpenseCategory,
  type ExpenseDuplicate,
  type ExpenseRecord,
} from "@/lib/expenses/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tab = "expenses" | "reports" | "settings";
type Filter = "all" | "approval" | "pending" | "incomplete" | "approved" | "rejected" | "draft";

const CATEGORY_ICONS: Record<ExpenseCategory, string> = {
  fuel: "local_gas_station",
  materials: "inventory_2",
  tools: "construction",
  vehicle: "directions_car",
  parking_tolls: "local_parking",
  travel_meals: "restaurant",
  subcontractor: "engineering",
  office: "print",
  phone_internet: "smartphone",
  other: "receipt_long",
};

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "approval", label: "Needs approval" },
  { id: "pending", label: "Pending review" },
  { id: "incomplete", label: "Incomplete" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "draft", label: "Drafts" },
];

function matchesFilter(expense: ExpenseRecord, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "approval":
      return expense.status === "pending" && expense.overLimit;
    default:
      return expense.status === filter;
  }
}

function sumAud(expenses: ExpenseRecord[]): number {
  return expenses.reduce((total, expense) => total + Math.round((expense.amountAud ?? 0) * 100), 0) / 100;
}

export function ExpensesBoard({ initialView, initialTab }: { initialView: string | null; initialTab: Tab }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [options, setOptions] = useState<ExpenseOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialView);
  const [uploading, setUploading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ file: File; duplicate: ExpenseDuplicate } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const [list, settings] = await Promise.all([
          expenseRequest<{ expenses: ExpenseRecord[] }>(user, "/api/expenses"),
          expenseRequest<ExpenseOptions>(user, "/api/expenses/settings"),
        ]);
        if (cancelled) return;
        setExpenses(list.expenses);
        setOptions(settings);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load expenses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, version]);

  const reload = useCallback(() => {
    setLoading(true);
    setVersion((current) => current + 1);
  }, []);
  const closeDrawer = useCallback(() => setSelectedId(null), []);

  const upsert = useCallback((expense: ExpenseRecord) => {
    setExpenses((current) => {
      const exists = current.some((item) => item.id === expense.id);
      return exists ? current.map((item) => (item.id === expense.id ? expense : item)) : [expense, ...current];
    });
  }, []);

  const canManage = options?.canManage === true;
  const todayIso = options?.todayIso ?? new Date().toISOString().slice(0, 10);
  const monthPrefix = todayIso.slice(0, 7);

  const stats = useMemo(() => {
    const approval = expenses.filter((expense) => matchesFilter(expense, "approval"));
    const pending = expenses.filter((expense) => expense.status === "pending");
    const incomplete = expenses.filter((expense) => expense.status === "incomplete");
    const owed = expenses.filter((expense) => expense.status === "approved" && expense.reimbursement.status === "owed");
    const approvedThisMonth = expenses.filter(
      (expense) => expense.status === "approved" && expense.date?.startsWith(monthPrefix),
    );
    return { approval, pending, incomplete, owed, approvedThisMonth };
  }, [expenses, monthPrefix]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((item) => [item.id, expenses.filter((expense) => matchesFilter(expense, item.id)).length])) as Record<Filter, number>,
    [expenses],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return expenses.filter((expense) => {
      if (!matchesFilter(expense, filter)) return false;
      if (!query) return true;
      return [expense.vendor, expense.expenseCode, expense.submittedBy.name, expense.reason, expense.jobLabel, expense.vehicleLabel]
        .some((value) => value?.toLowerCase().includes(query));
    });
  }, [expenses, filter, search]);

  const selected = expenses.find((expense) => expense.id === selectedId) ?? null;

  async function startUpload(file: File, allowDuplicate = false) {
    if (!user) return;
    setUploading(true);
    setError(null);
    try {
      const expense = await uploadReceipt(user, file, { allowDuplicate });
      upsert(expense);
      setFilter("all");
      setSelectedId(expense.id);
    } catch (caught) {
      if (caught instanceof ExpenseApiError && caught.duplicate && !caught.duplicate.exact) {
        setPendingUpload({ file, duplicate: caught.duplicate });
      } else {
        setError(caught instanceof Error ? caught.message : "Could not add the receipt.");
      }
    } finally {
      setUploading(false);
    }
  }

  async function addWithoutReceipt() {
    if (!user) return;
    setUploading(true);
    setError(null);
    try {
      const result = await expenseRequest<{ expense: ExpenseRecord }>(user, "/api/expenses", {
        method: "POST",
        body: JSON.stringify({ date: todayIso }),
      });
      upsert(result.expense);
      setFilter("all");
      setSelectedId(result.expense.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the expense.");
    } finally {
      setUploading(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: "expenses", label: "Expenses", icon: "receipt_long" },
    ...(canManage
      ? [
          { id: "reports" as const, label: "Accountant overview", icon: "summarize" },
          { id: "settings" as const, label: "Settings", icon: "tune" },
        ]
      : []),
  ];

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-outline-variant/60 bg-surface-container-low p-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-body text-[13px] font-semibold transition-colors ${
                  tab === item.id ? "bg-surface-container-lowest text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
          {tab === "expenses" ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void startUpload(file);
                }}
              />
              <ActionButton tone="outline" disabled={uploading || !options} onClick={() => void addWithoutReceipt()}>
                <span className="material-symbols-outlined text-[18px]">edit_note</span>
                Add without receipt
              </ActionButton>
              <ActionButton tone="primary" busy={uploading} disabled={!options} onClick={() => fileInput.current?.click()}>
                {!uploading ? <span className="material-symbols-outlined text-[18px]">upload</span> : null}
                {uploading ? "Sophie is reading it…" : "Upload receipt"}
              </ActionButton>
            </div>
          ) : null}
        </div>

        <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary-container/15 px-4 py-3">
          <span className="material-symbols-outlined mt-0.5 text-[20px] text-primary">auto_awesome</span>
          <p className="font-body text-[13px] text-on-surface">
            Your team photographs receipts in the mobile app. Sophie reads each one, prepares a draft, catches duplicates and
            reminds people about missing receipts. <strong>You approve and reimburse; Sophie never pays anyone.</strong>
            {options && !options.receiptReading ? " Receipt reading is turned off on this server, so details must be typed in." : ""}
          </p>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">error</span>
            {error}
          </div>
        ) : null}

        {tab === "expenses" ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label="Needs your approval"
                value={String(stats.approval.length)}
                hint={stats.approval.length ? formatExpenseAud(sumAud(stats.approval)) : "Nothing over the limit"}
                tone="amber"
                active={filter === "approval"}
                onClick={() => setFilter("approval")}
              />
              <StatCard
                label="Pending review"
                value={String(stats.pending.length)}
                hint={formatExpenseAud(sumAud(stats.pending))}
                tone="primary"
                active={filter === "pending"}
                onClick={() => setFilter("pending")}
              />
              <StatCard
                label="Incomplete"
                value={String(stats.incomplete.length)}
                hint={`${stats.incomplete.filter((expense) => !expense.receipt).length} missing a receipt`}
                tone="orange"
                active={filter === "incomplete"}
                onClick={() => setFilter("incomplete")}
              />
              <StatCard
                label="Owed to staff"
                value={formatExpenseAud(sumAud(stats.owed))}
                hint={`Approved this month: ${formatExpenseAud(sumAud(stats.approvedThisMonth))}`}
                tone="green"
                active={false}
                onClick={() => setFilter("approved")}
              />
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((item) => {
                  const active = filter === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-body text-[13px] font-semibold transition-colors ${
                        active
                          ? "border-primary bg-primary text-on-primary shadow-sm"
                          : "border-outline-variant/70 bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      {item.label}
                      <span
                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                          active ? "bg-on-primary/20 text-on-primary" : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {counts[item.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search shop, person, code…"
                  className="h-10 w-full min-w-0 rounded-xl border border-outline-variant bg-surface-container-low px-3 font-body text-[13px] text-on-surface outline-none focus:border-primary lg:w-64"
                />
                <button
                  type="button"
                  onClick={reload}
                  disabled={loading}
                  aria-label="Refresh"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-outline-variant/70 bg-surface-container-low hover:bg-surface-container-high disabled:opacity-60"
                >
                  <span className={`material-symbols-outlined text-[18px] ${loading ? "animate-spin" : ""}`}>refresh</span>
                </button>
              </div>
            </div>

            {loading && expenses.length === 0 ? (
              <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-outline-variant/60 bg-surface-container-lowest font-body text-body-md text-on-surface-variant">
                <span className="material-symbols-outlined mr-2 animate-spin text-[22px] text-primary">progress_activity</span>
                Loading expenses…
              </div>
            ) : visible.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant/70 bg-surface-container-low px-6 py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-container/30 text-primary">
                  <span className="material-symbols-outlined text-[28px]">receipt_long</span>
                </span>
                <p className="mt-4 font-display text-[18px] font-semibold text-on-surface">
                  {expenses.length === 0 ? "No expenses yet" : "Nothing to show here"}
                </p>
                <p className="mt-2 max-w-sm font-body text-[14px] text-on-surface-variant">
                  {expenses.length === 0
                    ? "Upload a receipt here, or ask your team to snap receipts in the mobile app under More → Expenses."
                    : "Try another filter or search."}
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((expense) => (
                  <li key={expense.id}>
                    <ExpenseRow expense={expense} selected={selectedId === expense.id} onSelect={() => setSelectedId(expense.id)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}

        {tab === "reports" && canManage ? (
          <ExpenseReports expenses={expenses} todayIso={todayIso} onOpen={(expense) => setSelectedId(expense.id)} />
        ) : null}

        {tab === "settings" && canManage && options ? (
          <ExpenseSettingsPanel
            options={options}
            onSaved={(settings) => setOptions((current) => (current ? { ...current, settings } : current))}
          />
        ) : null}
      </div>

      <ExpenseDrawer
        expense={selected}
        options={options}
        onClose={closeDrawer}
        onChanged={upsert}
        onDeleted={(id) => {
          setExpenses((current) => current.filter((expense) => expense.id !== id));
          setSelectedId(null);
        }}
      />

      {pendingUpload ? (
        <DuplicateDialog
          duplicate={pendingUpload.duplicate}
          onCancel={() => setPendingUpload(null)}
          onConfirm={() => {
            const file = pendingUpload.file;
            setPendingUpload(null);
            void startUpload(file, true);
          }}
        />
      ) : null}
    </>
  );
}

function ExpenseRow({ expense, selected, onSelect }: { expense: ExpenseRecord; selected: boolean; onSelect: () => void }) {
  const checks = expense.sophie?.checks.length ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
        selected
          ? "border-primary/50 bg-primary-container/15"
          : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/30 hover:bg-surface-container-low"
      }`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface-variant">
        <span className="material-symbols-outlined text-[22px]">{CATEGORY_ICONS[expense.category]}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-[14px] font-semibold text-on-surface">
          {expense.vendor ?? "Details to add"}
          <span className="ml-1.5 font-normal text-on-surface-variant">{expense.expenseCode}</span>
        </p>
        <p className="truncate font-body text-[12px] text-on-surface-variant">
          {formatExpenseDate(expense.date)} · {EXPENSE_CATEGORY_LABELS[expense.category]} · {expense.submittedBy.name}
          {expense.jobLabel ? ` · ${expense.jobLabel}` : ""}
          {expense.vehicleLabel ? ` · ${expense.vehicleLabel}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {!expense.receipt ? <Chip tone="orange" icon="receipt">No receipt</Chip> : null}
          {expense.overLimit && expense.status !== "approved" && expense.status !== "rejected" ? (
            <Chip tone="amber" icon="price_check">Over limit</Chip>
          ) : null}
          {expense.reimbursement.status === "owed" ? <Chip tone="amber" icon="savings">Owed to {expense.submittedBy.name}</Chip> : null}
          {checks && expense.status === "draft" ? <Chip tone="primary" icon="auto_awesome">{checks} to check</Chip> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-body text-[15px] font-semibold tabular-nums text-on-surface">{formatExpenseAud(expense.amountAud)}</span>
        <ExpenseStatusBadge expense={expense} />
      </div>
    </button>
  );
}

const CHIP_TONES = {
  orange: "bg-orange-100 text-orange-800",
  amber: "bg-amber-100 text-amber-800",
  primary: "bg-primary-container/40 text-primary",
} as const;

function Chip({ tone, icon, children }: { tone: keyof typeof CHIP_TONES; icon: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${CHIP_TONES[tone]}`}>
      <span className="material-symbols-outlined text-[13px]">{icon}</span>
      {children}
    </span>
  );
}

const STAT_TONES = {
  amber: ["border-amber-400/50 bg-amber-50 ring-2 ring-amber-400/20", "hover:border-amber-300/50"],
  primary: ["border-primary/40 bg-primary-container/20 ring-2 ring-primary/15", "hover:border-primary/30"],
  orange: ["border-orange-400/50 bg-orange-50 ring-2 ring-orange-400/20", "hover:border-orange-300/50"],
  green: ["border-tertiary/40 bg-tertiary-container/30 ring-2 ring-tertiary/15", "hover:border-tertiary/30"],
} as const;

function StatCard({
  label,
  value,
  hint,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  tone: keyof typeof STAT_TONES;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition-all ${
        active ? STAT_TONES[tone][0] : `border-outline-variant/60 bg-surface-container-lowest ${STAT_TONES[tone][1]}`
      }`}
    >
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-1 font-display text-[1.6rem] font-semibold leading-none text-on-surface">{value}</p>
      <p className="mt-1 truncate font-body text-[12px] text-on-surface-variant">{hint}</p>
    </button>
  );
}
