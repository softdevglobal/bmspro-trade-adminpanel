/**
 * POST { question } — lets the owner test what Sophie would find, using the
 * exact retrieval Sophie uses (published entries of the owner's business only).
 * Works before AI_VOICE_KNOWLEDGE_ENABLED is turned on, so owners can check
 * their answers first. Does not record unanswered questions.
 */
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { knowledgeQuestionArguments } from "@/lib/ai/mcp/tools/action-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  const parsed = knowledgeQuestionArguments.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "Ask a question of 3–300 characters." }, 400);

  try {
    const { consumeRateLimits } = await import("@/lib/security/rate-limit");
    if (!await consumeRateLimits([{ key: `ai-knowledge-test:${auth.businessId}`, limit: 30, windowMs: 60_000 }])) {
      return json({ ok: false, error: "Too many test questions. Wait a minute and try again." }, 429);
    }
    const [{ adminDb }, { createEmbedder }, { createVectorStore }, { knowledgeSettings }] = await Promise.all([
      import("@/lib/firebase/admin"), import("@/lib/ai/rag/embeddings"), import("@/lib/ai/rag/vector-store"), import("@/lib/ai/rag/settings"),
    ]);
    const settings = knowledgeSettings();
    const started = performance.now();
    const [vector] = await createEmbedder(settings)([parsed.data.question]);
    const hits = await createVectorStore(adminDb).nearest(auth.businessId, vector, settings.topK, settings.maxDistance);
    return json({
      ok: true,
      status: hits.length ? "FOUND" : "NO_MATCH",
      durationMs: Math.round(performance.now() - started),
      voiceEnabled: settings.enabled,
      matches: hits.map(hit => ({ sourceId: hit.sourceId, title: hit.sourceTitle, text: hit.text, distance: Number(hit.distance.toFixed(3)) })),
    });
  } catch {
    return json({ ok: false, error: "Search is unavailable. Check that the knowledge index is ready." }, 503);
  }
}
