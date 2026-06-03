"use client";

import { useEffect, useMemo, useState } from "react";

export type DocumentDiscountMode = "percent" | "fixed";

export type DocumentDiscount = {
  mode: DocumentDiscountMode;
  /** Percent (0–100) when mode is percent. */
  percent: number;
  /** Fixed amount when mode is fixed. */
  amountAud: number;
};

type Props = {
  open: boolean;
  subtotalAud: number;
  initial: DocumentDiscount | null;
  onClose: () => void;
  onSave: (discount: DocumentDiscount | null) => void;
};

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

function clampDiscount(amount: number, subtotal: number): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(Math.min(amount, subtotal) * 100) / 100;
}

export function DiscountEditModal({
  open,
  subtotalAud,
  initial,
  onClose,
  onSave,
}: Props) {
  const [mode, setMode] = useState<DocumentDiscountMode>("percent");
  const [percentInput, setPercentInput] = useState("0");
  const [fixedInput, setFixedInput] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setMode(initial.mode);
      setPercentInput(String(initial.percent));
      setFixedInput(
        initial.mode === "fixed" ? initial.amountAud.toFixed(2) : "",
      );
      return;
    }
    setMode("percent");
    setPercentInput("0");
    setFixedInput("");
  }, [open, initial]);

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

  const discountAmount = useMemo(() => {
    if (mode === "percent") {
      return clampDiscount((subtotalAud * percent) / 100, subtotalAud);
    }
    return clampDiscount(fixedAmount, subtotalAud);
  }, [mode, percent, fixedAmount, subtotalAud]);

  if (!open) return null;

  function handleSave() {
    if (discountAmount <= 0) {
      onSave(null);
      onClose();
      return;
    }
    onSave({
      mode,
      percent: mode === "percent" ? percent : 0,
      amountAud: discountAmount,
    });
    onClose();
  }

  function handleClear() {
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
        aria-labelledby="discount-edit-title"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-outline-variant/60 px-5 py-4">
          <h2
            id="discount-edit-title"
            className="font-display text-[18px] font-semibold text-on-surface"
          >
            Edit discount
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
          <p className="font-body text-[13px] leading-relaxed text-on-surface-variant">
            The discount will be applied to the subtotal. This does not include
            discounts added to specific items.
          </p>

          <div className="flex items-center justify-between border-b border-outline-variant/40 pb-3 font-body text-[14px]">
            <span className="text-on-surface-variant">Subtotal</span>
            <span className="font-numeric font-semibold text-on-surface">
              {formatAud(subtotalAud)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              {mode === "percent" ? (
                <input
                  type="text"
                  inputMode="decimal"
                  value={percentInput}
                  onChange={(e) => setPercentInput(e.target.value)}
                  className="w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest py-2.5 pl-3 pr-8 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
                />
              ) : (
                <div className="relative">
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
              )}
              {mode === "percent" ? (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-body text-[14px] text-on-surface-variant">
                  %
                </span>
              ) : null}
            </div>

            <div className="relative grid shrink-0 grid-cols-2 rounded-full bg-[#1a1f28] p-0.5">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0.5 rounded-full bg-white shadow-sm transition-[left] duration-300 ease-out"
                style={{
                  width: "calc(50% - 2px)",
                  left: mode === "fixed" ? "calc(50%)" : "2px",
                }}
              />
              <button
                type="button"
                onClick={() => setMode("percent")}
                className={`relative z-10 rounded-full px-3 py-2 font-body text-[12px] font-semibold transition-colors duration-300 ${
                  mode === "percent"
                    ? "text-[#1a1f28]"
                    : "text-white/75 hover:text-white"
                }`}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setMode("fixed")}
                className={`relative z-10 rounded-full px-3 py-2 font-body text-[12px] font-semibold transition-colors duration-300 ${
                  mode === "fixed"
                    ? "text-[#1a1f28]"
                    : "text-white/75 hover:text-white"
                }`}
              >
                $
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2.5 font-body text-[13px]">
            <span className="text-on-surface-variant">Discount amount</span>
            <span className="font-numeric font-semibold text-on-surface">
              {formatAud(discountAmount)}
            </span>
          </div>
        </div>

        <footer className="flex flex-col gap-2 border-t border-outline-variant/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-xl bg-primary px-6 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="font-body text-[14px] font-semibold text-primary hover:underline"
            >
              Cancel
            </button>
          </div>
          {initial ? (
            <button
              type="button"
              onClick={handleClear}
              className="self-start py-1 font-body text-[13px] font-semibold text-error hover:underline"
            >
              Remove discount
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
