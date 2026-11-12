/**
 * POST — re-prepare ONE entry for Sophie (chunk + embed again). Used by the
 * dashboard's Retry button when an entry failed or got stuck on "Preparing",
 * for example because the server stopped before background indexing finished.
 */
import { after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KNOWLEDGE_SOURCES_COLLECTION } from "@/lib/ai/data/knowledge-sources";
import { indexInBackground } from "@/lib/ai/rag/import-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: Context) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) return json({ ok: false, error: "Knowledge entry not found." }, 404);
  try {
    const ref = adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(id);
    const data = (await ref.get()).data();
    if (!data || data.businessId !== auth.businessId || data.status === "archived") return json({ ok: false, error: "Knowledge entry not found." }, 404);
    const { consumeRateLimits } = await import("@/lib/security/rate-limit");
    if (!await consumeRateLimits([{ key: `ai-knowledge-retry:${auth.businessId}`, limit: 30, windowMs: 3_600_000 }])) {
      return json({ ok: false, error: "Too many retries. Try again in an hour." }, 429);
    }
    // Clear the old error so the dashboard shows "Preparing" again straight away.
    await ref.update({ indexError: null, indexRequestedAt: FieldValue.serverTimestamp() });
    after(() => indexInBackground(id, "retry"));
    return json({ ok: true, queued: true }, 202);
  } catch {
    return json({ ok: false, error: "Could not retry. Try again shortly." }, 503);
  }
}
