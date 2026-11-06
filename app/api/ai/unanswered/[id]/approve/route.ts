/** POST { answer, title? } — the owner answers a question; it becomes a FAQ Sophie can use. */
import { after } from "next/server";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KnowledgeError } from "@/lib/ai/data/knowledge-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(id)) return json({ ok: false, error: "Question not found." }, 404);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  const { answerUnansweredQuestion, unansweredAnswer } = await import("@/lib/ai/learning/approve");
  const parsed = unansweredAnswer.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "Write an answer of at least 10 characters." }, 400);
  try {
    const result = await answerUnansweredQuestion(auth.businessId, id, auth.uid, parsed.data);
    after(async () => {
      try { await (await import("@/lib/ai/rag/ingest")).indexKnowledgeSource(result.sourceId); }
      catch { console.error("[ai-knowledge] Indexing failed", { stage: "answer" }); }
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return error instanceof KnowledgeError
      ? json({ ok: false, error: error.message }, error.status)
      : json({ ok: false, error: "Could not save the answer." }, 503);
  }
}
