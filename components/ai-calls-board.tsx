"use client";

import { auth } from "@/lib/firebase/client";
import type { CallLogDetail, CallLogSummary, CallOutcome } from "@/lib/ai/data/call-logs";
import { useCallback, useEffect, useState } from "react";

const CARD_CLASS = "rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm sm:p-6";
const SECONDARY_BUTTON =
  "inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50";

const OUTCOME: Record<CallOutcome, { label: string; className: string }> = {
  booked: { label: "Booked", className: "bg-primary/10 text-primary" },
  request_sent: { label: "Request sent", className: "bg-primary/10 text-primary" },
  needs_staff: { label: "Staff to check", className: "bg-error-container/60 text-error" },
  no_booking: { label: "No booking", className: "bg-surface-container-high text-on-surface-variant" },
};
const TOOL_LABEL: Record<string, string> = {
  search_business_knowledge: "Answered from AI knowledge",
  get_available_slots: "Checked availability",
  list_services: "Looked up services",
  find_customer: "Looked up customer",
  register_customer: "Created customer account",
  create_inspection_request: "Sent inspection request",
  create_job_booking: "Booked job",
  find_job: "Looked up job",
  reschedule_job: "Rescheduled job",
  cancel_job: "Cancelled job",
  get_business_profile: "Loaded business details",
  end_call: "Sophie ended the call",
};

type ApiResult = { ok?: boolean; error?: string } & Record<string, unknown>;

async function authFetch(path: string, options: RequestInit = {}): Promise<ApiResult> {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...options, cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as ApiResult;
  if (!response.ok || body.ok === false) throw new Error(body.error || "Request failed.");
  return body;
}

async function fetchCalls(): Promise<{ ok: true; calls: CallLogSummary[] } | { ok: false; error: string }> {
  try { return { ok: true, calls: ((await authFetch("/api/ai/calls")).calls as CallLogSummary[]) ?? [] }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not load AI calls." }; }
}

const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};
const when = (ms: number | null) => ms === null ? "—" : new Date(ms).toLocaleString(undefined, {
  weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});
const offset = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function AiCallsBoard() {
  const [calls, setCalls] = useState<CallLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallLogDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchCalls>>) => {
    if (result.ok) { setCalls(result.calls); setError(null); } else setError(result.error);
    setLoading(false);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchCalls().then(result => { if (!cancelled) apply(result); });
    return () => { cancelled = true; };
  }, [apply]);

  async function open(call: CallLogSummary) {
    if (openId === call.id) { setOpenId(null); setDetail(null); return; }
    setOpenId(call.id); setDetail(null); setDetailLoading(true);
    try { setDetail((await authFetch(`/api/ai/calls/${call.id}`)).call as CallLogDetail); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load the call."); }
    finally { setDetailLoading(false); }
  }

  async function remove(call: CallLogSummary) {
    if (!window.confirm("Delete this call log, including its conversation text? This can't be undone.")) return;
    setBusy(true);
    try {
      await authFetch(`/api/ai/calls/${call.id}`, { method: "DELETE" });
      setCalls(current => current.filter(item => item.id !== call.id));
      if (openId === call.id) { setOpenId(null); setDetail(null); }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete the call."); }
    finally { setBusy(false); }
  }

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-on-surface">AI calls</h1>
          <p className="mt-1 max-w-2xl font-body text-[13px] text-on-surface-variant">
            Calls answered by Sophie, newest first. Open a call to read the conversation. Logs are deleted automatically after the retention period.
          </p>
        </div>
        <button type="button" disabled={busy} onClick={() => { setLoading(true); void fetchCalls().then(apply); }} className={SECONDARY_BUTTON}>
          <span className="material-symbols-outlined text-[16px]">refresh</span>Refresh
        </button>
      </div>

      {error && <p className="rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">{error}</p>}

      <div className={CARD_CLASS}>
        {calls.length === 0 ? (
          <p className="px-3 py-8 text-center font-body text-[13px] text-on-surface-variant">No AI calls yet. Calls appear here after they end.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {calls.map(call => {
              const outcome = OUTCOME[call.outcome];
              const isOpen = openId === call.id;
              return (
                <li key={call.id} className={`rounded-xl border ${isOpen ? "border-primary" : "border-outline-variant"}`}>
                  <button type="button" onClick={() => void open(call)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left">
                    <span className="material-symbols-outlined text-primary">{call.answered ? "call" : "call_missed"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-body text-[14px] font-semibold text-on-surface">{when(call.startedAt)}</span>
                        <span className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${outcome.className}`}>{outcome.label}</span>
                        {call.knowledgeSearches > 0 && (
                          <span className="rounded-full border border-outline-variant px-2 py-0.5 font-body text-[11px] text-on-surface-variant">
                            AI knowledge used {call.knowledgeSearches}×
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate font-body text-[12px] text-on-surface-variant">
                        {call.firstCallerLine ? `“${call.firstCallerLine}”` : call.answered ? "No caller speech recorded" : "Not answered"}
                      </span>
                    </span>
                    <span className="font-body text-[12px] text-on-surface-variant">
                      {duration(call.durationMs)}{call.callerNumber ? ` · ${call.callerNumber}` : ""}
                    </span>
                    <span className="material-symbols-outlined text-on-surface-variant">{isOpen ? "expand_less" : "expand_more"}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-outline-variant p-4">
                      {detailLoading || !detail ? (
                        <span className="material-symbols-outlined animate-spin text-[20px] text-primary">progress_activity</span>
                      ) : (
                        <div className="flex flex-col gap-4">
                          {detail.tools.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {detail.tools.map((tool, index) => (
                                <span key={index} className="rounded-full border border-outline-variant px-2 py-0.5 font-body text-[11px] text-on-surface-variant"
                                  title={`${tool.status} · ${tool.durationMs} ms`}>
                                  {TOOL_LABEL[tool.name] ?? tool.name}{tool.name === "search_business_knowledge" && tool.status === "NO_MATCH" ? " (no answer)" : ""}
                                </span>
                              ))}
                            </div>
                          )}
                          {detail.transcript.length === 0 ? (
                            <p className="font-body text-[13px] text-on-surface-variant">No conversation text was recorded for this call.</p>
                          ) : (
                            <ol className="flex max-h-[480px] flex-col gap-2 overflow-y-auto pr-1">
                              {detail.transcript.map((turn, index) => (
                                <li key={index} className={`flex ${turn.speaker === "caller" ? "justify-end" : "justify-start"}`}>
                                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 font-body text-[13px] ${turn.speaker === "caller" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface"}`}>
                                    <p className="mb-0.5 text-[10px] font-semibold opacity-75">{turn.speaker === "caller" ? "Caller" : "Sophie"} · {offset(turn.atMs)}</p>
                                    <p className="whitespace-pre-wrap">{turn.text}</p>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-body text-[11px] text-on-surface-variant">
                              Ended: {detail.endReason}. Speech-to-text can contain errors.
                            </p>
                            <button type="button" disabled={busy} onClick={() => void remove(call)} className={SECONDARY_BUTTON}>
                              <span className="material-symbols-outlined text-[14px]">delete</span>Delete log
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
