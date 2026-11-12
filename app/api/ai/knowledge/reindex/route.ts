/**
 * POST — rebuild "Business facts" and "Service descriptions" from current
 * settings, then re-embed every entry for the owner's business. Runs after the
 * response; rate-limited because it calls the embedding API for every passage.
 */
import { after } from "next/server";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const { consumeRateLimits } = await import("@/lib/security/rate-limit");
    if (!await consumeRateLimits([{ key: `ai-knowledge-reindex:${auth.businessId}`, limit: 5, windowMs: 3_600_000 }])) {
      return json({ ok: false, error: "Refresh limit reached. Try again in an hour." }, 429);
    }
  } catch {
    return json({ ok: false, error: "Could not start the refresh." }, 503);
  }
  after(async () => {
    try {
      const { refreshGeneratedSources, reindexBusiness } = await import("@/lib/ai/rag/ingest");
      await refreshGeneratedSources(auth.businessId);
      await reindexBusiness(auth.businessId);
    } catch { console.error("[ai-knowledge] Reindex failed"); }
  });
  return json({ ok: true, queued: true }, 202);
}
