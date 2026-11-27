import { after } from "next/server";
import { z } from "zod";

import { runAgent } from "@/lib/ai/agent/agent";
import { agentFlags } from "@/lib/ai/agent/config";
import { writeAgentEvent } from "@/lib/ai/agent/events";
import { AGENT_HANDLERS } from "@/lib/ai/agent/handlers";
import { decideGroup, MAX_GROUP } from "@/lib/ai/email/groups";
import { addCustomKind, kindChoices } from "@/lib/ai/email/kinds";
import { createEmailMemory } from "@/lib/ai/email/memory";
import { offerRuleAfterDecision, ruleView } from "@/lib/ai/email/rules";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid } from "@/lib/notifications/push";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  triageIds: z.array(z.string().max(64)).min(1).max(MAX_GROUP),
  /** A type from the list, or a new one of the owner's own (then `newKind`). */
  kind: z.string().max(80).optional(),
  newKind: z.object({ name: z.string().max(80), description: z.string().max(400) }).strict().optional(),
  actions: z.array(z.unknown()).min(1).max(6).optional(),
}).strict().refine((body) => (body.kind ? !body.newKind : !!body.newKind && !!body.actions));

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST one answer for a group of emails from the daily summary's "How should I handle these?"
 * (§6.3, §5.7): one decision per email. With `newKind`, the owner's own type is made first, with
 * these actions as what it suggests. Owner only.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose a type and what to do with these emails." }, 400);

    let kind = body.data.kind;
    if (body.data.newKind) {
      const added = await addCustomKind(adminDb, auth.businessId, { ...body.data.newKind, actions: body.data.actions }, auth.uid);
      if (!added.ok) return json({ error: added.error }, added.status);
      kind = added.kind.kind;
    }
    const { kinds, defaults } = await kindChoices(adminDb, auth.businessId);
    const result = await decideGroup(adminDb, {
      businessId: auth.businessId,
      triageIds: body.data.triageIds,
      actorUid: auth.uid,
      kind,
      actions: body.data.actions,
      kinds,
      defaults,
      memory: createEmailMemory(adminDb),
    });
    if (!result.ok) return json({ error: result.error }, result.status);

    for (const triageId of result.pending) {
      await writeAgentEvent(adminDb, { businessId: auth.businessId, type: "email.decided", entityId: triageId });
    }
    const flags = agentFlags();
    if (result.pending.length > 0 && flags.enabled) {
      after(() => runAgent({ db: adminDb, resolveOwnerUid: resolveBusinessOwnerUid, handlers: AGENT_HANDLERS, flags }, { budgetMs: 45_000 })
        .catch((error) => console.error("[ai/email/groups] agent run failed", (error as Error)?.name)));
    }
    const offer = result.last
      ? await offerRuleAfterDecision(adminDb, result.last).catch(() => null)
      : null;
    return json({
      ok: true,
      kind,
      decided: result.decided,
      skipped: result.skipped,
      running: result.pending.length,
      ruleOffer: offer ? ruleView(offer) : null,
    });
  } catch {
    return json({ error: "Could not save your answer." }, 500);
  }
}
