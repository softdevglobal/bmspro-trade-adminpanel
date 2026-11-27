"use client";

import Link from "next/link";
import {CancelConfirmModal} from "@/components/cancel-confirm-modal";
import {INVOICE_RESPONSE_LABELS,type InvoiceCollectionHold,type InvoiceCustomerResponse} from "@/lib/ai/calls/invoice-follow-up-policy";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";

type InvoiceCall = { id: string; attemptedAt: number; scheduledAt?: number | null; source?:string|null; status: string; reason?: string | null; callId: string | null; responses: string[]; customerResponse?:InvoiceCustomerResponse|null };
type InvoiceCalls = { collectionHold?:InvoiceCollectionHold|null; canResumeHold?:boolean; routes: string[]; canCall: boolean; unavailableReason: string | null; destination: string | null; history: InvoiceCall[] };
const labels: Record<string, string> = {
  REQUESTED: "Calling", ANSWERED: "Phone answered", NO_ANSWER: "No answer",
  FAILED: "Call failed", UNKNOWN: "Outcome unverified", QUEUED: "Waiting to call", SCHEDULED: "Customer requested a callback",
  CALLING: "Calling", CANCELLED: "Callback cancelled", SKIPPED: "Call skipped",
};

export function InvoiceCallPanel({ invoiceId, customer, customerNumber, overdue, timeZone }: {
  invoiceId: string; customer: string; customerNumber: string; overdue: boolean; timeZone?: string | null;
}) {
  const { user, role } = useAuth();
  const [data, setData] = useState<InvoiceCalls | null>(null);
  const [did, setDid] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewOpen,setReviewOpen]=useState(false);
  const [resuming,setResuming]=useState(false);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [customerOptedOut, setCustomerOptedOut] = useState<boolean | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);

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
    if (!user || role !== "business_owner" || !customerNumber) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/business/call-preferences", {
          method: "POST", headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
          body: JSON.stringify({ numbers: [customerNumber] }), cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not load customer call preference.");
        if (!cancelled) setCustomerOptedOut(result.optedOut?.[0] === true);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load customer call preference.");
      }
    })();
    return () => { cancelled = true; };
  }, [customerNumber, role, user]);

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
    if (!user || !route || !data?.canCall || !data.destination || busy || awaitingTranscript || customerOptedOut !== false ||
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

  async function resumeFollowUps(){
    if(!user||!data?.collectionHold||resuming)return;
    setResuming(true);setError("");
    try{
      const response=await fetch("/api/business/sophie-invoice-call",{method:"PATCH",headers:{Authorization:`Bearer ${await user.getIdToken()}`,"Content-Type":"application/json"},body:JSON.stringify({invoiceId,holdId:data.collectionHold.id,holdToken:data.collectionHold.reviewToken,reviewed:true})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not resume follow-ups.");
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not resume follow-ups.");}
    finally{setResuming(false);setReviewOpen(false);}
  }

  async function updateCallPreference() {
    if (!user || !customerNumber || customerOptedOut === null || savingPreference) return;
    const next = !customerOptedOut;
    if (!window.confirm(next
      ? `Block Sophie from calling ${customer}?`
      : `Only clear this block if the customer asked to receive calls again. Clear it for ${customer}?`)) return;
    setSavingPreference(true);
    setError("");
    try {
      const response = await fetch("/api/business/call-preferences", {
        method: "PATCH", headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ number: customerNumber, doNotCall: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update customer call preference.");
      setCustomerOptedOut(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update customer call preference.");
    } finally { setSavingPreference(false); }
  }

  if (role !== "business_owner" || (!overdue && !data?.history.length && !data?.collectionHold)) return null;
  return <section className="space-y-2 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">Sophie invoice calls</h3>
      <button type="button" className="text-primary underline" onClick={() => void load()}>Refresh call history</button>
    </div>
    {data?.collectionHold ? <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
      <p className="font-semibold">Follow-ups paused for review</p>
      <p>{INVOICE_RESPONSE_LABELS[data.collectionHold.reason]}</p>
      {data.collectionHold.promisedDate ? <p>Promised date: {data.collectionHold.promisedDate}</p> : null}
      <p className="text-xs">Customer statements do not verify payment. Review the ledger and call response before resuming. This pause does not expire automatically.</p>
      {data.canResumeHold===false ? <p className="text-xs font-semibold">Correct the invoice customer phone number before resuming.</p> : null}
      <button type="button" onClick={()=>setReviewOpen(true)} disabled={resuming||data.canResumeHold===false} className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Review and resume follow-ups</button>
    </div> : null}
    {overdue && <div className="flex flex-wrap items-center gap-2">
      {data?.canCall && data.routes.length > 1 && <select aria-label="Calling business number" value={did} onChange={event => setDid(event.target.value)}
        className="rounded-lg border border-outline-variant bg-surface px-2 py-2">
        <option value="">Choose business number</option>
        {data.routes.map(number => <option key={number} value={number}>{number}</option>)}
      </select>}
      <button type="button" disabled={!data?.canCall || !route || busy || awaitingTranscript || customerOptedOut !== false} onClick={() => void callCustomer()}
        className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary disabled:opacity-50">
        {busy ? "Calling…" : customerOptedOut ? "Customer opted out" : "Call with Sophie"}
      </button>
    </div>}
    {overdue && !data && !error && <p role="status">Checking Sophie call settings…</p>}
    {overdue && data?.unavailableReason && <p>{data.unavailableReason}</p>}
    {overdue && customerNumber && <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant/50 pt-2">
      <span className="text-xs text-on-surface-variant">{customerOptedOut === null ? "Checking call preference…"
        : customerOptedOut ? "Customer is blocked from Sophie calls." : "Customer can receive Sophie calls."}</span>
      <button type="button" disabled={customerOptedOut === null || savingPreference} onClick={() => void updateCallPreference()}
        className="rounded-lg border border-outline-variant px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50">
        {savingPreference ? "Saving…" : customerOptedOut ? "Allow Sophie calls" : "Block Sophie calls"}
      </button>
    </div>}
    {customerOptedOut && overdue && <p className="text-xs text-error">Sophie cannot call this customer while the block is active.</p>}
    {awaitingTranscript && <p role="status">Waiting for the call outcome or transcript.</p>}
    {error && <p role="alert" className="text-error">{error}</p>}
    {data?.history.map(call => <div key={call.id} className="space-y-1 border-t border-outline-variant/50 pt-2">
      <p className="font-medium">{call.status==="SCHEDULED"&&call.source==="invoice_no_answer_retry"?"No-answer retry scheduled":labels[call.status] ?? "Outcome unverified"} · {formatInPlatformTimeZone(
        call.status === "SCHEDULED" && call.scheduledAt ? call.scheduledAt : call.attemptedAt,
        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, timeZone)}</p>
      {call.reason && <p>{call.reason}</p>}
      {call.customerResponse ? <p className="text-amber-800">{INVOICE_RESPONSE_LABELS[call.customerResponse.outcome]}{call.customerResponse.promisedDate ? ` · ${call.customerResponse.promisedDate}` : ""} · Customer statement</p> : null}
      {call.responses.length > 0 && <details><summary className="cursor-pointer">Customer responses</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">{call.responses.map((response, index) => <li key={index}>{response}</li>)}</ul>
      </details>}
      {call.callId && <Link className="text-primary underline" href={`/dashboard/call-recordings?view=ai&callId=${call.callId}`}>Open full transcript</Link>}
    </div>)}
    <CancelConfirmModal open={reviewOpen} title="Resume invoice follow-ups?" description="Confirm you have checked the customer's response, the payment ledger and any dispute or support needs. Resuming allows future eligible follow-ups; it does not mark the invoice paid or place a call now." confirmLabel="Reviewed — resume follow-ups" cancelLabel="Keep paused" loadingLabel="Resuming…" isLoading={resuming} onCancel={()=>{if(!resuming)setReviewOpen(false);}} onConfirm={()=>void resumeFollowUps()} />
  </section>;
}
