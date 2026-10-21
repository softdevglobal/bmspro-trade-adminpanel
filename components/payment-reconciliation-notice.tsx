"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";

export function PaymentReconciliationNotice() {
  const { user } = useAuth();
  const [receipts, setReceipts] = useState<{ id: string; targetId: string; amountAud: number; reason: string; paymentIntentId: string }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/payments/reconciliation", { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error("Could not load payments awaiting review.");
        const data = await response.json();
        if (!cancelled) setReceipts(data.receipts);
      } catch (error) { if (!cancelled) setError(error instanceof Error ? error.message : "Could not load payments awaiting review."); }
    })();
    return () => { cancelled = true; };
  }, [user]);
  if (error) return <p role="status" className="text-sm text-red-700">{error}</p>;
  if (!receipts.length) return null;
  return <section className="my-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <h3 className="font-semibold">Payments awaiting review</h3>
    <p className="my-2 text-sm">These successful charges were retained without changing the invoice or deposit balance. Review them in Stripe before refunding or allocating funds.</p>
    <ul className="space-y-2 text-sm">{receipts.map((receipt) => <li key={receipt.id}>A${receipt.amountAud.toFixed(2)} · {receipt.targetId} · {receipt.paymentIntentId}<br />{receipt.reason}</li>)}</ul>
  </section>;
}
