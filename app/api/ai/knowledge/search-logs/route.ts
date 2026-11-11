/**
 * GET ?days=1|7|30 — how Sophie's knowledge searches went on real calls for the
 * owner's business: counts, timings, near misses and the most recent searches.
 * Logs hold the redacted question only and are deleted after 30 days.
 */
import { requireBusinessOwner } from "@/lib/onboarding/services/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const ALLOWED_DAYS = [1, 7, 30];
const MAX_ROWS = 2000;
const RECENT_ROWS = 25;

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const requested = Number(new URL(request.url).searchParams.get("days") ?? 7);
  const days = ALLOWED_DAYS.includes(requested) ? requested : 7;

  try {
    const [{ adminDb }, { Timestamp }, { KNOWLEDGE_SEARCH_LOGS_COLLECTION }, { summarizeSearchLogs, toSearchLogRow }] = await Promise.all([
      import("@/lib/firebase/admin"), import("firebase-admin/firestore"),
      import("@/lib/ai/data/knowledge-sources"), import("@/lib/ai/rag/search-stats"),
    ]);
    const snapshot = await adminDb.collection(KNOWLEDGE_SEARCH_LOGS_COLLECTION)
      .where("businessId", "==", auth.businessId)
      .where("createdAt", ">=", Timestamp.fromMillis(Date.now() - days * 86_400_000))
      .orderBy("createdAt", "desc")
      .limit(MAX_ROWS)
      .get();
    // Defence in depth: never trust the query alone for tenant isolation.
    const rows = snapshot.docs
      .filter(doc => doc.get("businessId") === auth.businessId)
      .map(doc => toSearchLogRow(doc.id, doc.data()));
    return json({
      ok: true,
      days,
      truncated: snapshot.size >= MAX_ROWS,
      summary: summarizeSearchLogs(rows),
      recent: rows.slice(0, RECENT_ROWS).map(row => ({
        id: row.id,
        question: row.question,
        status: row.status,
        createdAt: row.createdAt,
        totalMs: Number.isFinite(row.totalMs) ? Math.round(row.totalMs) : null,
        closestDistance: row.closestDistance,
        maxDistance: row.maxDistance,
        entries: [...new Set(row.hits.map(hit => hit.sourceTitle))].slice(0, 3),
        byKeyword: row.hits.some(hit => hit.keyword),
      })),
    });
  } catch {
    return json({ ok: false, error: "Could not load search activity. The search log index may still be building." }, 503);
  }
}
