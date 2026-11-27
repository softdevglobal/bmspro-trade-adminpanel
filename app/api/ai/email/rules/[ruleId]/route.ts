import { z } from "zod";

import { approveRule, declineRule, editOffer, ruleView, setRuleLevel } from "@/lib/ai/email/rules";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("action", [
  /** "Yes, do this from now on": the exact version the owner was shown (§5.4). */
  z.object({ action: z.literal("approve"), version: z.number().int().min(1) }).strict(),
  /** "Keep asking me". */
  z.object({ action: z.literal("decline"), version: z.number().int().min(1) }).strict(),
  /** "Edit": how sure Sophie must be and how soon she asks again. The result is a new version to approve. */
  z.object({ action: z.literal("edit"), version: z.number().int().min(1), minConfidence: z.number().optional(), reviewDays: z.number().int().optional() }).strict(),
  /** Moving down needs no confirmation. Moving up is only by approving an offer. */
  z.object({ action: z.literal("level"), level: z.enum(["suggest", "off"]) }).strict(),
]);

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * PATCH one rule: approve or decline an offer, or move it down to "ask me first" or off. Owner only,
 * in the app. Approving is never done by voice or by Sophie herself.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose what to do with this rule." }, 400);
    const { ruleId } = await params;
    const input = body.data;
    const result = input.action === "approve"
      ? await approveRule(adminDb, { businessId: auth.businessId, ruleId, version: input.version, actorUid: auth.uid })
      : input.action === "decline"
        ? await declineRule(adminDb, { businessId: auth.businessId, ruleId, version: input.version })
        : input.action === "edit"
          ? await editOffer(adminDb, { businessId: auth.businessId, ruleId, version: input.version, minConfidence: input.minConfidence, reviewDays: input.reviewDays })
          : await setRuleLevel(adminDb, { businessId: auth.businessId, ruleId, level: input.level });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, rule: ruleView(result.rule) });
  } catch {
    return json({ error: "Could not change the rule." }, 500);
  }
}
