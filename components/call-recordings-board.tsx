"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { formatTenantDate } from "@/lib/onboarding/tenant-display";
import { platformTodayIso } from "@/lib/platform/timezone";

type Recording = {
  id: string; did: string; startedAt: number; duration: number; grant: string;
  callerNumber: string | null; customerName: string | null;
};
type RecordingPage = { recordings: Recording[]; hasMore: boolean; hasRecordingHistory: boolean };
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

export function CallRecordingsBoard() {
  const { user, businessId } = useAuth();
  return user && businessId ? <Recordings key={user.uid + ":" + businessId} user={user} /> : null;
}

function Recordings({ user }: { user: User }) {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<RecordingPage | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Recording | null>(null);
  const [dateRange, setDateRange] = useState(() => {
    const today = platformTodayIso();
    return { from: today, to: today };
  });
  const [draftDates, setDraftDates] = useState(dateRange);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    if (dateRange.from) params.set("from", dateRange.from);
    if (dateRange.to) params.set("to", dateRange.to);
    void requestRecordings(user, "?" + params, { signal: controller.signal })
      .then(response => response.json() as Promise<RecordingPage>)
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [user, page, refresh, dateRange]);

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

  return <section className="min-w-0 space-y-4">
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
        <p className="font-body text-[13px] text-on-surface-variant">Loading call recordings…</p>
      </div>
      : <>
        {result.recordings.length === 0 && <p className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
          {result.hasRecordingHistory
            ? dateRange.from || dateRange.to ? "No recordings in this date range on this page." : "No recordings on this page."
            : "Recording history hasn’t started for this business. Ask your administrator to save its active DID mapping."}
        </p>}
        {(result.recordings.length > 0 || page > 1 || result.hasMore) && <div className="min-w-0 overflow-hidden rounded-xl border border-outline-variant bg-white">
          {result.recordings.length > 0 && <div role="region" aria-label="Scrollable recordings table" tabIndex={0}
            className="max-h-[min(60dvh,36rem)] overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
            <table aria-label="Call recordings" className="w-full min-w-[600px] text-left font-body text-[12px]">
              <thead className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest text-on-surface-variant">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">When</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Caller</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Business number</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Duration</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Recording</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {result.recordings.map(recording => {
                  const expanded = selected?.id === recording.id;
                  return <Fragment key={recording.id}>
                    <tr className="hover:bg-surface-container-lowest/80">
                      <td className="whitespace-nowrap px-3 py-2.5 text-on-surface-variant">{formatTenantDate(recording.startedAt)}</td>
                      <td className="px-3 py-2.5 text-on-surface">
                        {recording.customerName && <p className="font-semibold">{recording.customerName}</p>}
                        <p className="whitespace-nowrap tabular-nums text-on-surface-variant">{recording.callerNumber ?? "Number unavailable"}</p>
                      </td>
                      <td className="px-3 py-2.5 font-medium tabular-nums text-on-surface">{recording.did}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-on-surface-variant">{Math.floor(recording.duration / 60)}m {recording.duration % 60}s</td>
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" aria-expanded={expanded} className={controlClass}
                          onClick={() => setSelected(expanded ? null : recording)}>
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{expanded ? "close" : "play_circle"}</span>
                          {expanded ? "Close player" : "Load audio"}
                        </button>
                      </td>
                    </tr>
                    {expanded && <tr className="bg-surface-container-lowest">
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
