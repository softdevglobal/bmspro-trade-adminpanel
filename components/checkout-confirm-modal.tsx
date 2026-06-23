"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: string;
  tone?: "primary" | "warning";
  onCancel: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  loadingLabel?: string;
};

export function CheckoutConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  icon = "payments",
  tone = "primary",
  onCancel,
  onConfirm,
  isLoading = false,
  loadingLabel = "Processing…",
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  if (!open || !mounted) return null;

  const iconWrapClass =
    tone === "warning"
      ? "bg-amber-100 text-amber-800"
      : "bg-primary/10 text-primary";
  const confirmClass =
    tone === "warning"
      ? "bg-amber-600 text-white hover:bg-amber-700"
      : "bg-primary text-on-primary shadow-md shadow-primary/20 hover:bg-primary/90";

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
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
        aria-labelledby="checkout-confirm-title"
        aria-describedby="checkout-confirm-desc"
        className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl"
      >
        <div className="px-6 pt-6 text-center">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${iconWrapClass}`}
          >
            <span className="material-symbols-outlined text-[28px]">{icon}</span>
          </div>
          <h2
            id="checkout-confirm-title"
            className="font-display text-headline-sm font-semibold text-on-surface"
          >
            {title}
          </h2>
          <p
            id="checkout-confirm-desc"
            className="mt-2 font-body text-body-md text-on-surface-variant"
          >
            {description}
          </p>
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
            className={`flex h-11 items-center justify-center gap-2 rounded-lg px-5 font-body text-[14px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-70 ${confirmClass}`}
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
    </div>,
    document.body,
  );
}
