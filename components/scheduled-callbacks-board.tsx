"use client";

import { useCallback, useEffect, useState } from "react";
import { platformTodayIso } from "@/lib/platform/timezone";
import type { User } from "firebase/auth";
import { formatTenantDate } from "@/lib/onboarding/tenant-display";

type ScheduledCall = {
  id: string; status: string; scheduledAt: number | null; attemptedAt: number | null; completedAt: number | null;
  customerName: string | null; callerLastFour: string | null; did: string | null; purpose: string; reason: string | null;
  category?:string|null; instructions?:string|null; callLogId?:string|null;
};

const labels: Record<string, string> = {
  SCHEDULED: "Scheduled", CALLING: "Calling", ANSWERED: "Phone answered", NO_ANSWER: "No answer",
  FAILED: "Call failed", CANCELLED: "Cancelled", SKIPPED: "Skipped", UNKNOWN: "Outcome unverified",
};

export function ScheduledCallbacksBoard({ user }: { user: User }) {
  const [calls, setCalls] = useState<ScheduledCall[] | null>(null);
  const [date, setDate] = useState(() => platformTodayIso());
  const [error, setError] = useState("");
  const [conversation,setConversation]=useState<Record<string,{loading?:boolean;error?:string;turns?:{speaker:string;text:string}[]}>>({});
  const [cancelling,setCancelling]=useState<string|null>(null);
  async function cancelCall(id:string){
    setCancelling(id);
    try{
      const response=await fetch("/api/business/scheduled-callbacks",{method:"PATCH",headers:{Authorization:`Bearer ${await user.getIdToken()}`,"Content-Type":"application/json"},body:JSON.stringify({id,action:"cancel"})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not cancel call.");await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not cancel call.");}finally{setCancelling(null);}
  }
  async function showConversation(id:string){
    setConversation(current=>({...current,[id]:{loading:true}}));
    try{
      const response=await fetch(`/api/ai/calls/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${await user.getIdToken()}`},cache:"no-store"});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Conversation unavailable.");
      setConversation(current=>({...current,[id]:{turns:data.call?.transcript??[]}}));
    }catch(error){setConversation(current=>({...current,[id]:{error:error instanceof Error?error.message:"Conversation unavailable."}}));}
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/business/scheduled-callbacks?date=${encodeURIComponent(date)}`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` }, signal, cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load scheduled calls.");
      if (!signal?.aborted) { setCalls(result.calls); setError(""); }
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Could not load scheduled calls.");
    }
  }, [user, date]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    const interval = setInterval(() => void load(controller.signal), 30_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [load]);

  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col items-start gap-2">
      <p className="font-body text-[13px] text-on-surface-variant">Customer callbacks and calls scheduled by the owner.</p>
      <label className="flex items-center gap-2 font-body text-[13px] text-on-surface-variant">
        Scheduled date
        <input type="date" value={date} onChange={event => {
          if (!event.target.value) return;
          setDate(event.target.value); setCalls(null);
        }} className="h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-on-surface" />
      </label>
      </div>
      <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>Refresh
      </button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-700">{error}</p>}
    {!calls && !error && <p role="status" className="py-10 text-center text-sm text-on-surface-variant">Loading scheduled calls…</p>}
    {calls && calls.length === 0 && <p className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
      No scheduled calls for this date.
    </p>}
    {!!calls?.length && <div role="region" aria-label="Scrollable scheduled calls" tabIndex={0}
      className="max-h-[min(60dvh,36rem)] overflow-auto rounded-xl border border-outline-variant bg-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
      <table aria-label="Scheduled callback history" className="w-full min-w-[650px] text-left font-body text-[12px]">
        <thead className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest text-on-surface-variant">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-semibold">Scheduled time</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Customer</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Business number</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Call type</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/60">
          {calls.map(call => <tr key={call.id} className="align-top hover:bg-surface-container-lowest/80">
            <td className="whitespace-nowrap px-3 py-2.5 text-on-surface-variant">
              {formatTenantDate(call.scheduledAt ?? call.attemptedAt ?? call.completedAt ?? null)}
            </td>
            <td className="px-3 py-2.5 text-on-surface">
              {call.customerName && <p className="font-semibold">{call.customerName}</p>}
              <p className="tabular-nums text-on-surface-variant">{call.callerLastFour ? `Ending ${call.callerLastFour}` : "Number unavailable"}</p>
            </td>
            <td className="px-3 py-2.5 font-medium tabular-nums text-on-surface">{call.did ?? "—"}</td>
            <td className="max-w-md px-3 py-2.5 text-on-surface-variant">
              <p>{call.purpose}{call.category?` · ${call.category}`:""}</p>
              {call.instructions&&<p className="mt-1 whitespace-pre-wrap break-words">{call.instructions}</p>}
              {call.instructions&&!call.callLogId&&["ANSWERED","CALLING","UNKNOWN"].includes(call.status)&&<p className="mt-1 text-xs">Conversation not available yet.</p>}
              {call.callLogId&&<>
                <button type="button" disabled={conversation[call.callLogId]?.loading} onClick={()=>void showConversation(call.callLogId!)} className="mt-2 font-semibold text-primary underline">{conversation[call.callLogId]?.loading?"Loading response…":"View conversation and response"}</button>
                {conversation[call.callLogId]?.error&&<p role="alert">{conversation[call.callLogId].error}</p>}
                {conversation[call.callLogId]?.turns&&<div className="mt-2 max-h-64 space-y-2 overflow-auto rounded border border-outline-variant p-2">
                  <p className="text-xs">Recorded conversation. Caller statements require owner review; phone answered does not verify identity or payment.</p>
                  {conversation[call.callLogId].turns!.length===0&&<p>No conversation text was captured.</p>}
                  {conversation[call.callLogId].turns!.map((turn,index)=><p key={index} className="whitespace-pre-wrap break-words"><strong>{turn.speaker==="caller"?"Caller":"Sophie"}: </strong>{turn.text}</p>)}
                </div>}
              </>}
            </td>
            <td className="max-w-64 px-3 py-2.5 text-on-surface-variant">
              <span className="font-semibold text-on-surface">{labels[call.status] ?? "Outcome unverified"}</span>
              {call.reason && <p className="mt-1 break-words">{call.reason}</p>}
              {call.instructions&&call.status==="SCHEDULED"&&<button type="button" disabled={cancelling!==null} onClick={()=>void cancelCall(call.id)} className="mt-2 font-semibold text-rose-700 underline">{cancelling===call.id?"Cancelling…":"Cancel scheduled call"}</button>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </section>;
}
