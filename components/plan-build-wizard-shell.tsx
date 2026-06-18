"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

type Props = {
  open: boolean;
  title: string;
  subtitle: string;
  step: number;
  maxStep: number;
  stepError: string | null;
  saving?: boolean;
  editingId?: string | null;
  onClose: () => void;
  onBack: () => void;
  onContinue: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
  submitLabel: string;
  children: ReactNode;
};

export function PlanBuildWizardShell({
  open,
  title,
  subtitle,
  step,
  maxStep,
  stepError,
  saving = false,
  editingId = null,
  onClose,
  onBack,
  onContinue,
  onSubmit,
  onDelete,
  submitLabel,
  children,
}: Props) {
  const progressPercent = Math.round((step / maxStep) * 100);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative grid h-[94dvh] max-h-[94dvh] w-full max-w-5xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:h-[min(92dvh,calc(100dvh-2rem))] sm:max-h-[min(92dvh,calc(100dvh-2rem))] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">
              {title}
            </h2>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {subtitle}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant sm:max-w-md">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
          {stepError ? (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                error
              </span>
              <span>{stepError}</span>
            </div>
          ) : null}
          {children}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-variant bg-background px-5 py-4 shadow-[0_-8px_24px_rgba(0,42,150,0.08)] sm:px-6">
          <button
            type="button"
            onClick={step === 1 ? onClose : onBack}
            className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>

          <div className="flex items-center gap-2">
            {editingId && onDelete && step === maxStep ? (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-lg border border-error/30 px-4 py-2.5 font-body text-[13px] font-semibold text-error"
              >
                Delete
              </button>
            ) : null}
            {step < maxStep ? (
              <button
                type="button"
                onClick={onContinue}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary"
              >
                Continue
                <span className="material-symbols-outlined text-[18px]">
                  arrow_forward
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={onSubmit}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
              >
                {saving ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[18px]">
                      progress_activity
                    </span>
                    Saving…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    {submitLabel}
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export const PLAN_WIZARD_FIELD_CLASS =
  "mt-1.5 h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";

export const PLAN_WIZARD_TEXTAREA_CLASS =
  "mt-1.5 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";
