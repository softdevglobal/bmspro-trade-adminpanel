"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";

type InvoiceCall = { id: string; attemptedAt: number; status: string; reason?: string | null; callId: string | null; responses: string[] };
type InvoiceCalls = { routes: string[]; canCall: boolean; unavailableReason: string | null; destination: string | null; history: InvoiceCall[] };
const labels: Record<string, string> = {
  REQUESTED: "Calling", ANSWERED: "Phone answered", NO_ANSWER: "No answer",
  FAILED: "Call failed", UNKNOWN: "Outcome unverified", QUEUED: "Waiting to call", SKIPPED: "Call skipped",
};

export function InvoiceCallPanel({ invoiceId, customer, overdue, timeZone }: {
  invoiceId: string; customer: string; overdue: boolean; timeZone?: string | null;
}) {
  const { user, role } = useAuth();
  const [data, setData] = useState<InvoiceCalls | null>(null);
  const [did, setDid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!user || role !== "business_owner") return;
    try {
      const response = await fetch(`/api/business/sophie-invoice-call?invoiceId=${encodeURIComponent(invoiceId)}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal, cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load invoice calls.");
      if (!signal?.aborted) { setData(result); setError(""); }
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load invoice calls.");
    }
  }, [invoiceId, role, user]);

  useEffect(() => {
    const controller = new AbortController();
    const frame = requestAnimationFrame(() => void load(controller.signal));
    return () => {
      cancelAnimationFrame(frame);
      controller.abort();
    };
  }, [load]);

  const pending = pendingId ? data?.history.find(call => call.id === pendingId) : null;
  const awaitingTranscript = !!pendingId && (!pending || (!pending.callId && ["ANSWERED", "UNKNOWN", "REQUESTED"].includes(pending.status)));
  useEffect(() => {
    if (!awaitingTranscript) return;
    const controller = new AbortController();
    const interval = setInterval(() => void load(controller.signal), 8_000);
    const deadline = setTimeout(() => {
      setPendingId(null);
      setError("The transcript is taking longer than expected. Refresh call history to check again.");
    }, 15 * 60_000);
    return () => {
      controller.abort();
      clearInterval(interval);
      clearTimeout(deadline);
    };
  }, [awaitingTranscript, load]);

  const route = did || (data?.routes.length === 1 ? data.routes[0] : "");
  async function callCustomer() {
    if (!user || !route || !data?.canCall || !data.destination || busy || awaitingTranscript ||
        !window.confirm(`Have Sophie call ${customer} at ${data.destination} about this overdue invoice?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/business/sophie-invoice-call", {
        method: "POST", headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, did: route, requestId: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not start the invoice call.");
      setPendingId(result.status === "ANSWERED" || result.status === "UNKNOWN" ? result.attemptId : null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the invoice call.");
    } finally {
      setBusy(false);
    }
  }

  if (role !== "business_owner" || (!overdue && !data?.history.length)) return null;
  return <section className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">Sophie invoice calls</h3>
      <button type="button" className="text-primary underline" onClick={() => void load()}>Refresh call history</button>
    </div>
    {overdue && <div className="flex flex-wrap items-center gap-2">
      {data?.canCall && data.routes.length > 1 && <select aria-label="Calling business number" value={did} onChange={event => setDid(event.target.value)}
        className="rounded-lg border border-outline-variant bg-surface px-2 py-2">
        <option value="">Choose business number</option>
        {data.routes.map(number => <option key={number} value={number}>{number}</option>)}
      </select>}
      <button type="button" disabled={!data?.canCall || !route || busy || awaitingTranscript} onClick={() => void callCustomer()}
        className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary disabled:opacity-50">
        {busy ? "Calling…" : "Call with Sophie"}
      </button>
    </div>}
    {overdue && !data && !error && <p role="status">Checking Sophie call settings…</p>}
    {overdue && data?.unavailableReason && <p>{data.unavailableReason}</p>}
    {awaitingTranscript && <p role="status">Waiting for the call outcome or transcript.</p>}
    {error && <p role="alert" className="text-error">{error}</p>}
    {data?.history.map(call => <div key={call.id} className="space-y-1 border-t border-outline-variant/50 pt-2">
      <p className="font-medium">{labels[call.status] ?? "Outcome unverified"} · {formatInPlatformTimeZone(call.attemptedAt,
        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, timeZone)}</p>
      {call.reason && <p>{call.reason}</p>}
      {call.responses.length > 0 && <details><summary className="cursor-pointer">Customer responses</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">{call.responses.map((response, index) => <li key={index}>{response}</li>)}</ul>
      </details>}
      {call.callId && <Link className="text-primary underline" href={`/dashboard/call-recordings?view=ai&callId=${call.callId}`}>Open full transcript</Link>}
    </div>)}
  </section>;
}
