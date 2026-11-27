import { emailActionDeps } from "@/lib/ai/agent/handlers";
import { undoDecisionAction } from "@/lib/ai/email/actions";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST: undo one of Sophie's actions. The id is `<triageId>.<action kind>`, for example
 * `3f…a1.move_folder`. Owner only. Pausing and undoing never need a confirmation: they only stop things.
 */
export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const [triageId, kind] = (await params).actionId.split(".");
    const result = await undoDecisionAction(emailActionDeps(adminDb), {
      businessId: auth.businessId,
      triageId: triageId ?? "",
      kind: kind ?? "",
      actorUid: auth.uid,
    });
    return result.ok ? json({ ok: true, summary: result.summary }) : json({ error: result.error }, result.status);
  } catch {
    return json({ error: "Couldn't undo that. Try again." }, 500);
  }
}
