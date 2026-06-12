"use client";

import { MonthCalendarField } from "@/components/month-calendar-field";
import { useEffect, useMemo, useState } from "react";

export type DepositRequestMode = "percent" | "fixed";

export type DepositRequest = {
  mode: DepositRequestMode;
  /** Percent (0–100) when mode is percent, otherwise unused. */
  percent: number;
  amountAud: number;
  dueDate: string;
};

type Props = {
  open: boolean;
  quotationTotalAud: number;
  initial: DepositRequest | null;
  defaultDueDate: string;
  minDueDate: string;
  title?: string;
  totalLabel?: string;
  amountLabel?: string;
  saveLabel?: string;
  removeLabel?: string;
  onClose: () => void;
  onSave: (deposit: DepositRequest | null) => void;
};

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

function clampDeposit(amount: number, total: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(Math.min(amount, total) * 100) / 100;
}

export function DepositRequestModal({
  open,
  quotationTotalAud,
  initial,
  defaultDueDate,
  minDueDate,
  title = "Deposit request",
  totalLabel = "Quotation total",
  amountLabel = "Deposit amount",
  saveLabel = "Save",
  removeLabel = "Remove deposit request",
  onClose,
  onSave,
}: Props) {
  const [mode, setMode] = useState<DepositRequestMode>("percent");
  const [percentInput, setPercentInput] = useState("50");
  const [fixedInput, setFixedInput] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setMode(initial.mode);
      setPercentInput(String(initial.percent));
      setFixedInput(
        initial.mode === "fixed" ? initial.amountAud.toFixed(2) : "",
      );
      setDueDate(initial.dueDate);
      return;
    }
    setMode("percent");
    setPercentInput("50");
    setFixedInput("");
    setDueDate(defaultDueDate);
  }, [open, initial, defaultDueDate]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  const percent = Math.min(
    100,
    Math.max(0, Number.parseFloat(percentInput.replace(/[^\d.]/g, "")) || 0),
  );

  const fixedAmount = Math.max(
    0,
    Number.parseFloat(fixedInput.replace(/[^\d.]/g, "")) || 0,
  );

  const depositAmount = useMemo(() => {
    if (mode === "percent") {
      return clampDeposit((quotationTotalAud * percent) / 100, quotationTotalAud);
    }
    return clampDeposit(fixedAmount, quotationTotalAud);
  }, [mode, percent, fixedAmount, quotationTotalAud]);

  if (!open) return null;

  function handleSave() {
    if (depositAmount <= 0) {
      onSave(null);
      onClose();
      return;
    }
    onSave({
      mode,
      percent: mode === "percent" ? percent : 0,
      amountAud: depositAmount,
      dueDate,
    });
    onClose();
  }

  function handleRemove() {
    onSave(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-request-title"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-outline-variant/60 px-5 py-4">
          <h2
            id="deposit-request-title"
            className="font-display text-[18px] font-semibold text-on-surface"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <div className="flex items-center justify-between border-b border-outline-variant/40 pb-3 font-body text-[14px]">
            <span className="text-on-surface-variant">{totalLabel}</span>
            <span className="font-numeric font-semibold text-on-surface">
              {formatAud(quotationTotalAud)}
            </span>
          </div>

          <div className="relative grid grid-cols-2 border-b border-outline-variant/60">
            <button
              type="button"
              onClick={() => setMode("percent")}
              className={`pb-2.5 font-body text-[13px] font-semibold transition-colors ${
                mode === "percent"
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Percent (%)
            </button>
            <button
              type="button"
              onClick={() => setMode("fixed")}
              className={`pb-2.5 font-body text-[13px] font-semibold transition-colors ${
                mode === "fixed"
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Fixed (Aus $)
            </button>
            <span
              aria-hidden
              className="absolute bottom-0 h-0.5 w-1/2 bg-primary transition-[left] duration-300 ease-out"
              style={{ left: mode === "fixed" ? "50%" : "0" }}
            />
          </div>

          {mode === "percent" ? (
            <label className="block">
              <span className="font-body text-[13px] font-medium text-on-surface">
                Set percentage
              </span>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={percentInput}
                  onChange={(e) => setPercentInput(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest py-2.5 pl-3 pr-8 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-body text-[14px] text-on-surface-variant">
                  %
                </span>
              </div>
            </label>
          ) : (
            <label className="block">
              <span className="font-body text-[13px] font-medium text-on-surface">
                {amountLabel}
              </span>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-body text-[14px] text-on-surface-variant">
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fixedInput}
                  onChange={(e) => setFixedInput(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest py-2.5 pl-7 pr-3 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
                />
              </div>
            </label>
          )}

          <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2.5 font-body text-[13px]">
            <span className="text-on-surface-variant">{amountLabel}</span>
            <span className="font-numeric font-semibold text-on-surface">
              {formatAud(depositAmount)}
            </span>
          </div>

          <MonthCalendarField
            label="Due date"
            selectedIso={dueDate}
            minDate={minDueDate}
            onSelect={setDueDate}
          />
        </div>

        <footer className="flex flex-col gap-2 border-t border-outline-variant/60 px-5 py-4">
          <button
            type="button"
            onClick={handleSave}
            className="w-full rounded-xl bg-primary py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            {saveLabel}
          </button>
          {initial ? (
            <button
              type="button"
              onClick={handleRemove}
              className="w-full py-2 font-body text-[13px] font-semibold text-error hover:underline"
            >
              {removeLabel}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
