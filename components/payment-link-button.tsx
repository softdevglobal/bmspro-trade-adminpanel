"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useState } from "react";

type PaymentLinkButtonProps = {
  type: "quotation" | "invoice";
  targetId: string;
  label?: string;
  copiedLabel?: string;
  icon?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Owner/staff control that mints a secure payment link for a quotation deposit
 * or invoice and copies it to the clipboard to share with the customer.
 */
export function PaymentLinkButton({
  type,
  targetId,
  label = "Copy payment link",
  copiedLabel = "Link copied!",
  icon = "link",
  className,
  disabled,
}: PaymentLinkButtonProps) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/payments/link", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type, targetId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error ?? "Could not create the payment link.");
      }
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        window.prompt("Copy this payment link:", data.url);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the payment link.",
      );
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => void handleClick()}
      className={
        className ??
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-outline-variant px-3 font-body text-[12.5px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
      }
      title="Create a secure payment link to share with the customer"
    >
      <span className="material-symbols-outlined text-[16px]">
        {error ? "error" : copied ? "check" : icon}
      </span>
      {error ? "Try again" : copied ? copiedLabel : busy ? "Creating…" : label}
    </button>
  );
}
