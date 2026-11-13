"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { AiCallsBoard } from "@/components/ai-calls-board";
import { formatTenantDate } from "@/lib/onboarding/tenant-display";
import { platformTodayIso } from "@/lib/platform/timezone";
import { useMissedCallsCount } from "@/lib/notifications/missed-calls-context";

type Recording = {
  id: string; rowKey: string; did: string; startedAt: number; duration: number; grant: string | null;
  callerNumber: string | null; customerName: string | null;
  callerKey?: string | null; callbackGrant?: string | null; callbackComplete?: boolean;
};
type RecordingPage = { recordings: Recording[]; hasMore: boolean; hasRecordingHistory: boolean };
type RecordingResponse = Omit<RecordingPage, "recordings"> & {
  recordings: (Omit<Recording, "rowKey"> & { rowKey?: string })[];
};
const endpoint = "/api/business/call-recordings";
const controlClass = "inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45";
const dateClass = "h-9 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-sm text-on-surface";

async function requestRecordings(user: User, path: string, options: RequestInit) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", "Bearer " + await user.getIdToken());
  const response = await fetch(endpoint + path, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Could not load call recordings.");
  }
  return response;
}

type CallView = "recordings" | "missed" | "ai";
type InitialCallView = { initialView: CallView; initialDate?: string };

export function CallRecordingsBoard(props: InitialCallView) {
  const { user, businessId } = useAuth();
  return user && businessId ? <Recordings key={user.uid + ":" + businessId} user={user} businessId={businessId} {...props} /> : null;
}

function Recordings({ user, businessId, initialView, initialDate }: InitialCallView & { user: User; businessId: string }) {
  const { unread, capped } = useMissedCallsCount();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<RecordingPage | null>(null);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [callbackError, setCallbackError] = useState("");
  const [savingCallback, setSavingCallback] = useState<string | null>(null);
  const markReadOnLoad = useRef(initialView === "missed");
  const [selected, setSelected] = useState<Recording | null>(null);
  const [view, setView] = useState<CallView>(initialView);
  const missed = view === "missed";
  const listLabel = missed ? "missed calls" : "recordings";
  const [dateRange, setDateRange] = useState(() => {
    const date = initialDate ?? platformTodayIso();
    return { from: date, to: date };
  });
  const [draftDates, setDraftDates] = useState(dateRange);

  useEffect(() => {
    if (view === "ai") return;
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), view });
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    void requestRecordings(user, "?" + params, { signal: controller.signal })
      .then(response => response.json() as Promise<RecordingResponse>)
      .then(async data => {
        if (controller.signal.aborted) return;
        const rows = new Map<string, Recording>();
        for (const recording of data.recordings) {
          const rowKey = recording.rowKey || "legacy:" + JSON.stringify([recording.id, recording.did, recording.startedAt]);
          if (!rows.has(rowKey)) rows.set(rowKey, { ...recording, rowKey });
        }
        setResult({ ...data, recordings: [...rows.values()] });
        if (view !== "missed" || !markReadOnLoad.current) return;
        markReadOnLoad.current = false;
        try {
          await requestRecordings(user, "", { method: "PATCH", signal: controller.signal });
          if (!controller.signal.aborted) {
            window.dispatchEvent(new CustomEvent("trade:missed-calls-read", { detail: { businessId, uid: user.uid } }));
          }
        } catch (reason) {
          if (!controller.signal.aborted) setReadError(reason instanceof Error ? reason.message : "Could not mark missed calls as read.");
        }
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [user, businessId, page, refresh, dateRange, view]);

  function load(nextPage: number) {
    setResult(null);
    setError("");
    setSelected(null);
    setPage(nextPage);
    setRefresh(value => value + 1);
  }

  function applyDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDateRange(draftDates);
    load(1);
  }

  async function completeCallback(recording: Recording) {
    if (!recording.callbackGrant || !recording.callerKey || savingCallback) return;
    setSavingCallback(recording.rowKey);
    setCallbackError("");
    try {
      await requestRecordings(user, "", { method: "PATCH", headers: { "x-callback-grant": recording.callbackGrant } });
      setResult(current => current && ({
        ...current,
        recordings: current.recordings.map(row => row.callerKey === recording.callerKey && row.startedAt <= recording.startedAt
          ? { ...row, callbackComplete: true } : row),
      }));
    } catch (reason) {
      setCallbackError(reason instanceof Error ? reason.message : "Could not complete the callback.");
    } finally {
      setSavingCallback(null);
    }
  }

  const groups = new Map<string, { recording: Recording; count: number }>();
  for (const recording of result?.recordings ?? []) {
    const key = missed && recording.callerKey ? `caller:${recording.callerKey}` : `row:${recording.rowKey}`;
    const group = groups.get(key);
    groups.set(key, {
      recording: group && group.recording.startedAt >= recording.startedAt ? group.recording : recording,
      count: (group?.count ?? 0) + 1,
    });
  }

  return <section className="min-w-0 space-y-4">
    {missed && callbackError && <p role="alert" className="text-sm text-error">{callbackError}</p>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Call history view">
      {([
        { value: "recordings", label: "Recordings" },
        { value: "missed", label: "Missed calls" },
        { value: "ai", label: "AI calls" },
      ] as const).map(({ value: option, label }) => (
        <button key={option} type="button" aria-pressed={view === option}
          className={controlClass + (view === option ? " border-primary text-primary" : "")}
          onClick={() => {
            markReadOnLoad.current = option === "missed";
            setReadError("");
            setView(option);
            load(1);
          }}>
          {label}
          {option === "missed" && unread > 0 && (
            <span aria-label={`${capped ? "At least " : ""}${unread} unread missed calls`}
              className="rounded-full bg-rose-600 px-1.5 text-[11px] leading-5 text-white">
              {unread}{capped ? "+" : ""}
            </span>
          )}
        </button>
      ))}
    </div>
    {view === "ai" ? <AiCallsBoard /> : <>
    {readError && <p role="alert" className="text-sm text-error">{readError}</p>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <form onSubmit={applyDates} onReset={(event) => {
        event.preventDefault();
        const cleared = { from: "", to: "" };
        setDraftDates(cleared);
        setDateRange(cleared);
        load(1);
      }}
        className="flex flex-wrap items-end gap-2" aria-label="Filter recordings by date">
        <label className="grid gap-1 font-body text-xs font-medium text-on-surface-variant">
          From
          <input type="date" name="from" className={dateClass} value={draftDates.from}
            onChange={event => setDraftDates({ ...draftDates, from: event.target.value })} />
        </label>
        <label className="grid gap-1 font-body text-xs font-medium text-on-surface-variant">
          To
          <input type="date" name="to" className={dateClass} value={draftDates.to}
            onChange={event => setDraftDates({ ...draftDates, to: event.target.value })} />
        </label>
        <button type="submit" className={controlClass}>Apply</button>
        <button type="reset" className={controlClass}>Clear</button>
      </form>
      <button type="button" onClick={() => load(1)} disabled={!result && !error} className={controlClass}>
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>
        Refresh
      </button>
    </div>
    {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] font-semibold text-rose-700">{error}</p>
      : !result ? <div role="status" className="flex min-h-[240px] flex-col items-center justify-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary" aria-hidden="true">progress_activity</span>
        <p className="font-body text-[13px] text-on-surface-variant">Loading {listLabel}…</p>
      </div>
      : <>
        {result.recordings.length === 0 && <p className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
          {result.hasRecordingHistory
            ? missed && (dateRange.from || dateRange.to)
              ? "No missed calls on this page for the selected dates. Clear the filters to see earlier calls."
              : `No ${listLabel} on this page.`
            : "Recording history hasn’t started for this business. Ask your administrator to save its active DID mapping."}
        </p>}
        {(result.recordings.length > 0 || page > 1 || result.hasMore) && <div className="min-w-0 overflow-hidden rounded-xl border border-outline-variant bg-white">
          {result.recordings.length > 0 && <div role="region" aria-label="Scrollable recordings table" tabIndex={0}
            className="max-h-[min(60dvh,36rem)] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
            <table aria-label={missed ? "Missed calls" : "Call recordings"} className="w-full min-w-[600px] text-left font-body text-[12px]">
              <thead className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest text-on-surface-variant">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">When</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Caller</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Business number</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Duration</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">{missed ? "Status and action" : "Recording"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {[...groups.values()].map(({ recording, count }) => {
                  const expanded = selected?.rowKey === recording.rowKey;
                  const callbackNumber = recording.callerNumber?.replace(/[\s().-]/g, "") ?? "";
                  return <Fragment key={recording.rowKey}>
                    <tr className="hover:bg-surface-container-lowest/80">
                      <td className="whitespace-nowrap px-3 py-2.5 text-on-surface-variant">{formatTenantDate(recording.startedAt)}</td>
                      <td className="px-3 py-2.5 text-on-surface">
                        {recording.customerName && <p className="font-semibold">{recording.customerName}</p>}
                        <p className="whitespace-nowrap tabular-nums text-on-surface-variant">{recording.callerNumber ?? "Number unavailable"}</p>
                        {count > 1 && <p className="text-on-surface-variant">{count} missed calls on this page</p>}
                      </td>
                      <td className="px-3 py-2.5 font-medium tabular-nums text-on-surface">{recording.did}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-on-surface-variant">{Math.floor(recording.duration / 60)}m {recording.duration % 60}s</td>
                      <td className="px-3 py-2.5 text-right">
                        {missed ? <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <span className="font-medium text-on-surface-variant">{recording.callbackComplete ? "Callback complete" : "No answer"}</span>
                          {/^\+?\d{1,15}$/.test(callbackNumber) && <button type="button" className={controlClass}
                            aria-label={`Call back ${recording.customerName ?? callbackNumber}`}
                            onClick={() => window.dispatchEvent(new CustomEvent("trade:missed-call-callback", {
                              detail: { number: callbackNumber, businessId, uid: user.uid },
                            }))}>
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">call</span>
                            Call back
                          </button>}
                          {!recording.callbackComplete && recording.callbackGrant && <button type="button" className={controlClass}
                            disabled={savingCallback !== null} onClick={() => void completeCallback(recording)}>
                            {savingCallback === recording.rowKey ? "Saving…" : "Mark callback complete"}
                          </button>}
                        </div> : <button type="button" aria-expanded={expanded} className={controlClass}
                          onClick={() => setSelected(expanded ? null : recording)}>
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{expanded ? "close" : "play_circle"}</span>
                          {expanded ? "Close player" : "Load audio"}
                        </button>}
                      </td>
                    </tr>
                    {expanded && recording.grant && <tr className="bg-surface-container-lowest">
                      <td colSpan={5} className="px-3 py-3"><Player key={recording.grant} user={user} grant={recording.grant} /></td>
                    </tr>}
                  </Fragment>;
                })}
              </tbody>
            </table>
          </div>}
          {(page > 1 || result.hasMore) && <nav aria-label="Recording pages" className="flex items-center gap-2 px-3 py-3">
            <button type="button" disabled={page === 1} onClick={() => load(page - 1)} className={controlClass}>
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_left</span>
              Previous
            </button>
            <span className="min-w-[5.5rem] text-center font-body text-[12px] font-medium text-on-surface-variant">Page {page}</span>
            <button type="button" disabled={!result.hasMore} onClick={() => load(page + 1)} className={controlClass}>
              Next
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">chevron_right</span>
            </button>
          </nav>}
        </div>}
      </>}
    </>}
  </section>;
}

function Player({ user, grant }: { user: User; grant: string }) {
  const [audio, setAudio] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void requestRecordings(user, "", {
      method: "POST", headers: { "X-Recording-Grant": grant }, signal: controller.signal,
    }).then(response => response.blob()).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setAudio(objectUrl);
    }).catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user, grant]);

  if (error) return <p role="alert" className="text-sm text-error">{error}</p>;
  return audio ? <audio controls src={audio} aria-label="Call recording" className="w-full max-w-md" />
    : <p role="status" className="text-sm">Loading audio…</p>;
}
