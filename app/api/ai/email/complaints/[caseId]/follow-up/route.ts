import { emailActionDeps } from "@/lib/ai/agent/handlers";
import { sendFollowUp } from "@/lib/ai/email/complaints/follow-up";
import { emailComplaintsEnabled, emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST "Ask if it's fixed" after a return visit (§10.7): sends the follow-up email once, through the
 * reply gate. The owner's tap, never automatic. Owner only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable() || !emailComplaintsEnabled()) return json({ error: "Complaint handling isn't switched on yet." }, 404);
    const { caseId } = await params;
    const result = await sendFollowUp(emailActionDeps(adminDb), { businessId: auth.businessId, caseId, actorUid: auth.uid });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
  } catch {
    return json({ error: "Could not send the follow-up." }, 500);
  }
}
