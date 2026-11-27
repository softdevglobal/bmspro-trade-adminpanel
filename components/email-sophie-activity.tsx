"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import type { BillItem, RecentDecision } from "@/lib/ai/email/activity";

const STATUS_TONE: Record<string, string> = {
  done: "text-emerald-700",
  undone: "text-on-surface-variant",
  skipped: "text-on-surface-variant",
  needs_details: "text-amber-800",
  manual: "text-amber-800",
  blocked: "text-rose-700",
  failed: "text-rose-700",
  dry_run: "text-on-surface-variant",
};

/**
 * Emails → Sophie: what Sophie did with your recent answers, with Undo on each action that can be
 * undone (docs/sophie-email-learning-and-auto-reply.md step 6), and the bills she added from email.
 */
export function EmailSophieActivity({ refreshKey }: { refreshKey: number }) {
  const { user } = useAuth();
  const [data, setData] = useState<{ decisions: RecentDecision[]; bills: BillItem[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai/email/activity", { headers: { Authorization: "Bearer " + await user.getIdToken() } });
        const result = await response.json();
        if (!cancelled && response.ok && result.available) setData({ decisions: result.decisions, bills: result.bills });
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user, version, refreshKey]);

  async function undo(triageId: string, kind: string) {
    if (!user) return;
    // Undoing a request cancels it, and the customer may be told, as when you cancel one yourself.
    if ((kind === "create_inspection" || kind === "create_job_request") &&
        !window.confirm("Cancel this request? The customer may get the usual cancellation email.")) return;
    const key = `${triageId}.${kind}`;
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch(`/api/ai/email/actions/${key}/undo`, {
        method: "POST",
        headers: { Authorization: "Bearer " + await user.getIdToken() },
      });
      const result = await response.json();
      setMessage(response.ok ? result.summary : result.error ?? "Couldn't undo that.");
      setVersion((value) => value + 1);
    } catch {
      setMessage("Couldn't undo that. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!data || (data.decisions.length === 0 && data.bills.length === 0)) return null;
  return (
    <div className="space-y-4">
      {message ? <p role="status" className="rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-[12px] text-on-surface">{message}</p> : null}

      {data.bills.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-outline-variant/70 bg-white p-4">
          <h3 className="font-display text-[15px] font-semibold text-on-surface">Bills from email</h3>
          <p className="text-[12px] text-on-surface-variant">Amounts are as written in the email and not checked. Sophie never pays anything.</p>
          <ul className="divide-y divide-outline-variant/50">
            {data.bills.map((bill) => (
              <li key={bill.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span className="text-on-surface">{bill.supplierName}{bill.reference ? ` · ${bill.reference}` : ""}</span>
                <span className="text-on-surface-variant">{bill.amountAsWritten || "Amount not stated"} · due {bill.dueDate}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.decisions.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-outline-variant/70 bg-white p-4">
          <h3 className="font-display text-[15px] font-semibold text-on-surface">Done recently</h3>
          <ul className="space-y-3">
            {data.decisions.map((decision) => (
              <li key={decision.triageId} className="space-y-1.5 border-t border-outline-variant/50 pt-3 first:border-t-0 first:pt-0">
                <p className="text-[13px] text-on-surface">
                  <span className="font-semibold">{decision.kindLabel}</span> from {decision.sender}
                  {decision.subject ? <span className="text-on-surface-variant">: {decision.subject}</span> : null}
                  {decision.byRule ? <span className="ml-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800">By Sophie, under your rule</span> : null}
                </p>
                <ul className="space-y-1">
                  {decision.actions.map((action) => (
                    <li key={action.kind} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                      <span className={STATUS_TONE[action.status] ?? "text-on-surface-variant"}>{action.summary}</span>
                      {action.canUndo ? (
                        <button type="button" disabled={busy !== null} onClick={() => void undo(decision.triageId, action.kind)}
                          className="shrink-0 font-semibold text-primary disabled:opacity-50">
                          {busy === `${decision.triageId}.${action.kind}` ? "Undoing…" : "Undo"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
