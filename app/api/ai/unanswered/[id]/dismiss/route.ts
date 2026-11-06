/** POST — the owner hides a question that doesn't need an answer. */
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
  try {
    const { dismissUnansweredQuestion } = await import("@/lib/ai/learning/approve");
    await dismissUnansweredQuestion(auth.businessId, id, auth.uid);
    return json({ ok: true });
  } catch (error) {
    return error instanceof KnowledgeError
      ? json({ ok: false, error: error.message }, error.status)
      : json({ ok: false, error: "Could not dismiss the question." }, 503);
  }
}
