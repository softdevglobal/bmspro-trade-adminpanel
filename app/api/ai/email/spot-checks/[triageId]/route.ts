import { z } from "zod";

import { answerSpotCheck } from "@/lib/ai/email/rules";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({ verdict: z.enum(["right", "wrong"]) }).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST the owner's answer to "Check one of mine" (§5.5). "Wrong" counts as a correction: the rule
 * goes back to asking. Owner only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ triageId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Say whether Sophie got it right." }, 400);
    const { triageId } = await params;
    const result = await answerSpotCheck(adminDb, { businessId: auth.businessId, triageId, verdict: body.data.verdict });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, demoted: result.demoted });
  } catch {
    return json({ error: "Could not save your answer." }, 500);
  }
}
