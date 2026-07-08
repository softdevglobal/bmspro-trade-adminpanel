"use client";

import { useEffect, type ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  /** Use when this dialog opens above another modal. */
  stacked?: boolean;
};

/** Styled confirmation dialog for cancelling a request, job, or invoice. */
export function CancelConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Yes, cancel",
  cancelLabel = "Keep it",
  loadingLabel = "Cancelling...",
  onCancel,
  onConfirm,
  isLoading = false,
  stacked = false,
}: Props) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isLoading) onCancel();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel, isLoading]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${
        stacked ? "z-[120]" : "z-[110]"
      }`}
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        disabled={isLoading}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-confirm-title"
        aria-describedby="cancel-confirm-desc"
        className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl"
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-200">
            <span className="material-symbols-outlined material-symbols-filled text-[28px]">
              cancel
            </span>
          </div>
          <h2
            id="cancel-confirm-title"
            className="font-display text-headline-sm font-semibold text-on-surface"
          >
            {title}
          </h2>
          <div
            id="cancel-confirm-desc"
            className="mt-2 space-y-2 font-body text-body-md text-on-surface-variant"
          >
            {description}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-outline-variant bg-surface-container-low px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex h-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest px-5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-rose-600 px-5 font-body text-[14px] font-semibold text-white transition-all hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                {loadingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
