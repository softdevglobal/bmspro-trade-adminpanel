import { z } from "zod";

import { decideTemplate } from "@/lib/ai/email/reply-learning";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** "approve": use exactly this wording. "decline": don't ask again. "remove": stop using an approved one. */
  action: z.enum(["approve", "decline", "remove"]),
  version: z.number().int().min(1),
}).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * PATCH one saved reply: approve the exact wording shown, decline it, or remove one in use. Only in
 * the app, only the owner: Sophie and the voice tools can never approve a template.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose what to do with this reply." }, 400);
    const { id } = await params;
    const result = await decideTemplate(adminDb, { businessId: auth.businessId, id, version: body.data.version, action: body.data.action, actorUid: auth.uid });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, template: result.template });
  } catch {
    return json({ error: "Could not change this reply." }, 500);
  }
}
