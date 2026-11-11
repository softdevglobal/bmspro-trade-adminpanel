/**
 * Turns knowledge search logs (ai_knowledge_search_logs) into the numbers shown on
 * the dashboard and by `npm run ai-knowledge -- search-stats`. Pure: no Firestore,
 * so the API route, the CLI and tests all share it.
 */

export type SearchLogRow = {
  id: string;
  question: string;
  status: "FOUND" | "NO_MATCH";
  passagesSent: number;
  hits: { sourceTitle: string; keyword: boolean; distance: number | null }[];
  closestDistance: number | null;
  embedMs: number;
  nearestMs: number;
  keywordMs: number;
  totalMs: number;
  maxDistance: number;
  createdAt: number | null; // epoch ms
};

export type TimingSummary = { step: "embed" | "nearest" | "keyword" | "total"; p50: number; p95: number; max: number };

export type SearchSummary = {
  total: number;
  found: number;
  noMatch: number;
  /** Answered only because keyword search found the entry (meaning search missed it). */
  keywordOnly: number;
  timings: TimingSummary[];
  /** Cut-off used by the most recent search. */
  maxDistance: number | null;
  /** NO_MATCH searches whose closest entry was within `margin` past the cut-off. */
  nearMisses: { margin: number; count: number }[];
  /** Entries Sophie used most often. */
  topEntries: { title: string; count: number }[];
};

const NEAR_MISS_STEPS = [0.025, 0.05, 0.1, 0.15];

/** Nearest-rank percentile; NaN when there are no values. */
export function percentile(values: number[], p: number): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

export function summarizeSearchLogs(rows: SearchLogRow[]): SearchSummary {
  const noMatchRows = rows.filter(row => row.status === "NO_MATCH");
  const maxDistance = rows.length ? rows[0].maxDistance : null;
  const timing = (step: TimingSummary["step"], pick: (row: SearchLogRow) => number): TimingSummary => {
    const values = rows.map(pick).filter(Number.isFinite);
    const round = (value: number) => (Number.isFinite(value) ? Math.round(value) : 0);
    return { step, p50: round(percentile(values, 0.5)), p95: round(percentile(values, 0.95)), max: round(values.length ? Math.max(...values) : NaN) };
  };
  const entryCounts = new Map<string, number>();
  for (const row of rows) {
    for (const title of new Set(row.hits.map(hit => hit.sourceTitle))) entryCounts.set(title, (entryCounts.get(title) ?? 0) + 1);
  }
  return {
    total: rows.length,
    found: rows.length - noMatchRows.length,
    noMatch: noMatchRows.length,
    keywordOnly: rows.filter(row => row.hits.some(hit => hit.keyword && hit.distance === null) && !row.hits.some(hit => hit.distance !== null)).length,
    timings: [
      timing("embed", row => row.embedMs),
      timing("nearest", row => row.nearestMs),
      timing("keyword", row => row.keywordMs),
      timing("total", row => row.totalMs),
    ],
    maxDistance,
    nearMisses: NEAR_MISS_STEPS.map(margin => ({
      margin,
      count: noMatchRows.filter(row => row.closestDistance !== null && row.closestDistance <= row.maxDistance + margin).length,
    })),
    topEntries: [...entryCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([title, count]) => ({ title, count })),
  };
}

/** Reads one Firestore log document into a row, with safe defaults for missing fields. */
export function toSearchLogRow(id: string, data: Record<string, unknown>): SearchLogRow {
  const number = (value: unknown, fallback = NaN) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const createdAt = data.createdAt as { toMillis?: () => number } | null | undefined;
  const hits = Array.isArray(data.hits) ? data.hits : [];
  return {
    id,
    question: typeof data.question === "string" ? data.question : "",
    status: data.status === "NO_MATCH" ? "NO_MATCH" : "FOUND",
    passagesSent: number(data.passagesSent, 0),
    hits: hits.map(hit => {
      const value = (hit ?? {}) as Record<string, unknown>;
      return {
        sourceTitle: typeof value.sourceTitle === "string" ? value.sourceTitle : "",
        keyword: value.keyword === true,
        distance: typeof value.distance === "number" ? value.distance : null,
      };
    }),
    closestDistance: typeof data.closestDistance === "number" ? data.closestDistance : null,
    embedMs: number(data.embedMs),
    nearestMs: number(data.nearestMs),
    keywordMs: number(data.keywordMs),
    totalMs: number(data.totalMs),
    maxDistance: number(data.maxDistance, 0.6),
    createdAt: typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : null,
  };
}
