"use client";

/**
 * "Search activity" card on the AI knowledge dashboard: how Sophie's knowledge
 * searches went on real calls (from ai_knowledge_search_logs, via
 * GET /api/ai/knowledge/search-logs). Owners use it to see what callers ask,
 * what Sophie couldn't answer, and how fast the search is.
 */
import { useCallback, useEffect, useState } from "react";
import type { SearchSummary, TimingSummary } from "@/lib/ai/rag/search-stats";

const CARD_CLASS = "rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm sm:p-6";
const SECONDARY_BUTTON =
  "inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50";

type RecentSearch = {
  id: string; question: string; status: "FOUND" | "NO_MATCH"; createdAt: number | null; totalMs: number | null;
  closestDistance: number | null; maxDistance: number; entries: string[]; byKeyword: boolean;
};
type Activity = { days: number; truncated: boolean; summary: SearchSummary; recent: RecentSearch[] };
type Fetcher = (path: string) => Promise<Record<string, unknown>>;

const PERIODS = [{ days: 1, label: "24 hours" }, { days: 7, label: "7 days" }, { days: 30, label: "30 days" }] as const;
/** A NO_MATCH whose closest entry was this close past the cut-off is worth a look. */
const NEAR_MISS_MARGIN = 0.05;

const STEP_LABEL: Record<TimingSummary["step"], { title: string; hint: string }> = {
  embed: { title: "Understanding the question", hint: "OpenAI turns the question into numbers. Repeat questions skip this." },
  nearest: { title: "Search by meaning", hint: "Firestore finds the closest entries." },
  keyword: { title: "Search by words", hint: "Runs at the same time as the two steps above." },
  total: { title: "Whole search", hint: "What the caller waits for, before Sophie speaks." },
};

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
const milliseconds = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`);

function timeAgo(epochMs: number | null, now: number): string {
  if (!epochMs) return "";
  const minutes = Math.round((now - epochMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(epochMs).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function StatTile({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: string }) {
  return (
    <div className="rounded-xl border border-outline-variant p-3">
      <div className="flex items-center gap-1.5 text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{icon}</span>
        <span className="font-body text-[12px] font-medium">{label}</span>
      </div>
      <p className="mt-1 font-display text-[22px] font-bold leading-tight text-on-surface">{value}</p>
      {detail && <p className="font-body text-[11px] text-on-surface-variant">{detail}</p>}
    </div>
  );
}

type Loaded = { days: number; at: number; activity: Activity | null; error: string | null };

async function fetchActivity(fetcher: Fetcher, days: number): Promise<Loaded> {
  try {
    const result = await fetcher(`/api/ai/knowledge/search-logs?days=${days}`);
    return { days, at: Date.now(), activity: result as unknown as Activity, error: null };
  } catch (cause) {
    return { days, at: Date.now(), activity: null, error: cause instanceof Error ? cause.message : "Could not load search activity." };
  }
}

export function AiSearchActivity({ fetcher }: { fetcher: Fetcher }) {
  const [days, setDays] = useState<number>(7);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // State is only set in the promise callback, never directly in the effect.
  useEffect(() => {
    let cancelled = false;
    void fetchActivity(fetcher, days).then(result => { if (!cancelled) setLoaded(result); });
    return () => { cancelled = true; };
  }, [fetcher, days]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchActivity(fetcher, days).then(result => { setLoaded(result); setRefreshing(false); });
  }, [fetcher, days]);

  // Data for another period is never shown while the chosen one loads.
  const current = loaded?.days === days ? loaded : null;
  const loading = !current || refreshing;
  const activity = current?.activity ?? null;
  const error = current?.error ?? null;
  const now = current?.at ?? 0;
  const summary = activity?.summary;
  const total = summary?.timings.find(timing => timing.step === "total");
  const nearMiss = summary?.nearMisses.find(item => item.margin === NEAR_MISS_MARGIN)?.count ?? 0;

  return (
    <div className={CARD_CLASS}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary" aria-hidden="true">monitoring</span>
          <h3 className="font-display text-[17px] font-bold text-on-surface">Search activity</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {PERIODS.map(period => (
            <button key={period.days} type="button" onClick={() => setDays(period.days)} aria-pressed={days === period.days}
              className={`rounded-full px-3 py-1 font-body text-[12px] font-medium transition-colors ${days === period.days ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface-variant hover:bg-surface-container-low"}`}>
              {period.label}
            </button>
          ))}
          <button type="button" onClick={refresh} disabled={loading} className={SECONDARY_BUTTON} aria-label="Refresh search activity">
            <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`} aria-hidden="true">{loading ? "progress_activity" : "refresh"}</span>
          </button>
        </div>
      </div>
      <p className="mb-4 font-body text-[13px] text-on-surface-variant">
        What callers asked Sophie about your business, and whether she found an answer. Kept for 30 days.
      </p>

      {error ? (
        <p className="rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">{error}</p>
      ) : !summary ? (
        <p className="px-3 py-6 text-center font-body text-[13px] text-on-surface-variant">Loading…</p>
      ) : summary.total === 0 ? (
        <p className="rounded-lg bg-surface-container-low px-3 py-6 text-center font-body text-[13px] text-on-surface-variant">
          No searches in the last {PERIODS.find(period => period.days === days)?.label}. They appear here after callers ask Sophie about your business.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon="search" label="Searches" value={String(summary.total)} detail={activity?.truncated ? "Showing the latest 2,000" : undefined} />
            <StatTile icon="check_circle" label="Answered" value={percent(summary.found, summary.total)} detail={`${summary.found} of ${summary.total}`} />
            <StatTile icon="help" label="Couldn't answer" value={String(summary.noMatch)} detail={percent(summary.noMatch, summary.total) + " of searches"} />
            <StatTile icon="timer" label="Typical search time" value={total ? milliseconds(total.p50) : "–"}
              detail={total ? `Slowest 5%: ${milliseconds(total.p95)}` : undefined} />
          </div>

          {(nearMiss > 0 || summary.keywordOnly > 0) && (
            <div className="flex flex-col gap-2">
              {nearMiss > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface">
                  <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">lightbulb</span>
                  <span>
                    {nearMiss} unanswered {nearMiss === 1 ? "question" : "questions"} nearly matched an entry (marked <strong>Nearly matched</strong> below).
                    If that entry does answer it, add the caller&apos;s wording to the entry, or answer the question in &ldquo;Questions Sophie couldn&apos;t answer&rdquo;.
                  </span>
                </p>
              )}
              {summary.keywordOnly > 0 && (
                <p className="flex items-start gap-2 px-3 font-body text-[12px] text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">match_word</span>
                  {summary.keywordOnly} {summary.keywordOnly === 1 ? "search was" : "searches were"} answered only by matching the caller&apos;s exact words (for example a product name or code).
                </p>
              )}
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Timing breakdown */}
            <div>
              <h4 className="mb-2 font-body text-[13px] font-semibold text-on-surface">Where the time goes</h4>
              <div className="overflow-x-auto">
                <table className="w-full font-body text-[12px]">
                  <thead>
                    <tr className="text-left text-on-surface-variant">
                      <th className="pb-1 pr-2 font-medium">Step</th>
                      <th className="pb-1 pr-2 text-right font-medium">Typical</th>
                      <th className="pb-1 pr-2 text-right font-medium">Slowest 5%</th>
                      <th className="pb-1 text-right font-medium">Slowest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.timings.map(timing => (
                      <tr key={timing.step} className={`border-t border-outline-variant ${timing.step === "total" ? "font-semibold text-on-surface" : "text-on-surface"}`}>
                        <td className="py-1.5 pr-2">
                          <span className="block">{STEP_LABEL[timing.step].title}</span>
                          <span className="block text-[11px] font-normal text-on-surface-variant">{STEP_LABEL[timing.step].hint}</span>
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{milliseconds(timing.p50)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{milliseconds(timing.p95)}</td>
                        <td className="py-1.5 text-right tabular-nums">{milliseconds(timing.max)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Most used entries */}
            <div>
              <h4 className="mb-2 font-body text-[13px] font-semibold text-on-surface">Entries Sophie used most</h4>
              {summary.topEntries.length === 0 ? (
                <p className="font-body text-[12px] text-on-surface-variant">None yet.</p>
              ) : (
                <ol className="flex flex-col">
                  {summary.topEntries.map(entry => (
                    <li key={entry.title} className="flex items-center justify-between gap-3 border-t border-outline-variant py-1.5 font-body text-[12px] text-on-surface first:border-t-0">
                      <span className="min-w-0 truncate">{entry.title}</span>
                      <span className="shrink-0 tabular-nums text-on-surface-variant">{entry.count} {entry.count === 1 ? "search" : "searches"}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          {/* Recent searches */}
          <div>
            <h4 className="mb-2 font-body text-[13px] font-semibold text-on-surface">Recent searches</h4>
            <ul className="flex flex-col gap-2">
              {activity?.recent.map(search => {
                const answered = search.status === "FOUND";
                const nearlyMatched = !answered && search.closestDistance !== null && search.closestDistance <= search.maxDistance + NEAR_MISS_MARGIN;
                return (
                  <li key={search.id} className="rounded-xl border border-outline-variant px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 font-body text-[13px] text-on-surface">&ldquo;{search.question}&rdquo;</p>
                      <span className="shrink-0 font-body text-[11px] text-on-surface-variant">
                        {timeAgo(search.createdAt, now)}{search.totalMs !== null ? ` · ${milliseconds(search.totalMs)}` : ""}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-[12px] text-on-surface-variant">
                      <span className={`inline-flex items-center gap-1 font-semibold ${answered ? "text-primary" : "text-on-surface-variant"}`}>
                        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">{answered ? "check_circle" : "help"}</span>
                        {answered ? "Answered" : "Not answered"}
                      </span>
                      {answered && search.entries.length > 0 && <span>from {search.entries.join(", ")}{search.byKeyword ? " · matched your words" : ""}</span>}
                      {nearlyMatched && (
                        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-medium text-on-surface"
                          title={`Closest entry was ${search.closestDistance?.toFixed(3)}; the cut-off is ${search.maxDistance}. Lower is closer.`}>
                          Nearly matched
                        </span>
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
