"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { quotationAwaitingCustomerAcceptance } from "@/lib/quotations/actions";
import { useState } from "react";

type QuotationOwnerDecisionButtonsProps = {
  quotationId: string;
  status: "draft" | "sent";
  bookingId: string | null;
  customerDecision: "accepted" | "rejected" | null;
  onDecided?: (decision: "accepted" | "rejected") => void;
  className?: string;
};

const btnBase =
  "inline-flex items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 font-body text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function QuotationOwnerDecisionButtons({
  quotationId,
  status,
  bookingId,
  customerDecision,
  onDecided,
  className = "",
}: QuotationOwnerDecisionButtonsProps) {
  const { user } = useAuth();
  const [deciding, setDeciding] = useState<"accepted" | "rejected" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const awaiting = quotationAwaitingCustomerAcceptance({
    status,
    bookingId,
    customerDecision,
  });

  if (!awaiting) return null;

  async function record(decision: "accepted" | "rejected") {
    if (!user) return;
    setDeciding(decision);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/quotations/${quotationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "customer_decision", decision }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save decision.");
      }
      onDecided?.(decision);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save decision.",
      );
    } finally {
      setDeciding(null);
    }
  }

  return (
    <div className={className}>
      <p className="font-body text-[11px] font-semibold text-on-surface-variant">
        Record customer decision
      </p>
      {error ? (
        <p className="mt-1 font-body text-[11px] font-semibold text-rose-600">
          {error}
        </p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={deciding !== null}
          onClick={() => void record("accepted")}
          className={`${btnBase} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        >
          <span
            className={`material-symbols-outlined text-[14px] ${
              deciding === "accepted" ? "animate-spin" : ""
            }`}
          >
            {deciding === "accepted" ? "progress_activity" : "check_circle"}
          </span>
          {deciding === "accepted" ? "Saving…" : "Accept"}
        </button>
        <button
          type="button"
          disabled={deciding !== null}
          onClick={() => void record("rejected")}
          className={`${btnBase} border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}
        >
          <span
            className={`material-symbols-outlined text-[14px] ${
              deciding === "rejected" ? "animate-spin" : ""
            }`}
          >
            {deciding === "rejected" ? "progress_activity" : "cancel"}
          </span>
          {deciding === "rejected" ? "Saving…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
