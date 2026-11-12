/** GET — open questions Sophie could not answer for the owner's business (redacted text only). */
import { requireBusinessOwner } from "@/lib/onboarding/services/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const { listOpenUnansweredQuestions } = await import("@/lib/ai/data/unanswered-questions");
    return json({ ok: true, questions: await listOpenUnansweredQuestions(auth.businessId) });
  } catch {
    return json({ ok: false, error: "Could not load unanswered questions." }, 503);
  }
}
