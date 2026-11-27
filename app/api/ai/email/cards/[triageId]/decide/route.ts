import { after } from "next/server";
import { z } from "zod";

import { runAgent } from "@/lib/ai/agent/agent";
import { agentFlags } from "@/lib/ai/agent/config";
import { writeAgentEvent } from "@/lib/ai/agent/events";
import { AGENT_HANDLERS } from "@/lib/ai/agent/handlers";
import { decideCard, type CardChoice } from "@/lib/ai/email/decisions";
import { kindChoices } from "@/lib/ai/email/kinds";
import { createEmailMemory } from "@/lib/ai/email/memory";
import { offerRuleAfterDecision, ruleView } from "@/lib/ai/email/rules";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid } from "@/lib/notifications/push";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("confirm"), actions: z.array(z.unknown()).max(6).optional(), details: z.unknown().optional() }).strict(),
  z.object({ choice: z.literal("change_kind"), kind: z.string().max(80), actions: z.array(z.unknown()).max(6).optional(), details: z.unknown().optional() }).strict(),
  z.object({ choice: z.literal("other_actions"), actions: z.array(z.unknown()).min(1).max(6), details: z.unknown().optional() }).strict(),
  z.object({ choice: z.literal("ignore") }).strict(),
  z.object({ choice: z.literal("mark_private") }).strict(),
]);

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/**
 * POST the owner's answer on one card (§6.2, §5.7): "Do this", "This isn't a …", "Do something
 * else", "Ignore" or "Yes, private". Owner only. Saves one decision per email; a second tap is refused.
 */
export async function POST(request: Request, { params }: { params: Promise<{ triageId: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Choose what to do with this email." }, 400);
    const { triageId } = await params;
    const { kinds, defaults } = await kindChoices(adminDb, auth.businessId);
    const result = await decideCard(adminDb, {
      businessId: auth.businessId,
      triageId,
      actorUid: auth.uid,
      via: "app",
      choice: body.data as CardChoice,
      kinds,
      defaults,
      memory: createEmailMemory(adminDb),
      details: "details" in body.data ? body.data.details : undefined,
      timeZone: auth.timezone,
    });
    if (!result.ok) return json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, result.status);
    if (result.decision.actionsStatus === "pending") {
      // The runner carries the actions out, with retries; start it now rather than in 5 minutes.
      await writeAgentEvent(adminDb, { businessId: auth.businessId, type: "email.decided", entityId: triageId });
      const flags = agentFlags();
      if (flags.enabled) {
        after(() => runAgent({ db: adminDb, resolveOwnerUid: resolveBusinessOwnerUid, handlers: AGENT_HANDLERS, flags }, { budgetMs: 45_000 })
          .catch((error) => console.error("[ai/email/decide] agent run failed", (error as Error)?.name)));
      }
    }
    // The same answer N times in a row: offer to do it alone from now on (§5.3). Best effort.
    const offer = await offerRuleAfterDecision(adminDb, result.decision)
      .catch((error) => { console.error("[ai/email/decide] rule offer failed", (error as Error)?.name); return null; });
    return json({
      ok: true,
      confirmedKind: result.decision.confirmedKind,
      actionsStatus: result.decision.actionsStatus,
      sameInARow: result.sameInARow,
      ruleOffer: offer ? ruleView(offer) : null,
    });
  } catch {
    return json({ error: "Could not save your answer." }, 500);
  }
}
