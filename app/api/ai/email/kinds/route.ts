import { z } from "zod";

import { actionLabel, PICKABLE_EXAMPLES } from "@/lib/ai/email/action-list";
import { DETAIL_ACTIONS } from "@/lib/ai/email/details";
import { addCustomKind, listCustomKinds, pickableKinds } from "@/lib/ai/email/kinds";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().max(80),
  description: z.string().max(400),
  actions: z.array(z.unknown()).min(1).max(6),
}).strict();

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** Actions a type or a group of emails can have: the fixed list, without the ones that need one email's details. */
const GROUP_ACTIONS = PICKABLE_EXAMPLES
  .filter((action) => !DETAIL_ACTIONS.includes(action.kind))
  .map((action) => ({ action, label: actionLabel(action) }));

/** GET the owner's own email types, every type they can pick, and the actions a type can have. Owner only. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const [custom, kinds] = await Promise.all([listCustomKinds(adminDb, auth.businessId), pickableKinds(adminDb, auth.businessId)]);
    return json({
      custom: custom.map((kind) => ({ ...kind, actions: kind.actions.map((action) => ({ action, label: actionLabel(action) })) })),
      kinds,
      actions: GROUP_ACTIONS,
    });
  } catch {
    return json({ error: "Could not load your email types." }, 500);
  }
}

/** POST { name, description, actions }: a new type of the owner's own (§6.3). Sophie sorts into it from the next email. */
export async function POST(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ error: "Give the type a name, a short description and what Sophie should do." }, 400);
    const result = await addCustomKind(adminDb, auth.businessId, body.data, auth.uid);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, created: result.created, kind: result.kind }, result.created ? 201 : 200);
  } catch {
    return json({ error: "Could not save the type." }, 500);
  }
}
