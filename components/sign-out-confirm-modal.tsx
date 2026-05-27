"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
};

export function SignOutConfirmModal({
  open,
  onCancel,
  onConfirm,
  isLoading = false,
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
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
        aria-labelledby="sign-out-title"
        aria-describedby="sign-out-desc"
        className="relative w-full max-w-[400px] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl"
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error-container/80 text-error">
            <span className="material-symbols-outlined material-symbols-filled text-[28px]">
              logout
            </span>
          </div>
          <h2
            id="sign-out-title"
            className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface"
          >
            Sign out?
          </h2>
          <p
            id="sign-out-desc"
            className="mt-2 font-body text-body-md text-on-surface-variant"
          >
            You will need to sign in again to access the admin portal.
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-outline-variant bg-surface-container-low px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex h-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest px-5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-body text-[14px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Signing out...
              </>
            ) : (
              "Sign out"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
