import { actionLabel, PICKABLE_EXAMPLES } from "@/lib/ai/email/action-list";
import { listCards } from "@/lib/ai/email/cards";
import { pickableKinds } from "@/lib/ai/email/kinds";
import { emailTriageAvailable, getEmailSettings } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** Emails waiting for the owner's decision, newest first. Owner only. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    const [settings, cards, kinds] = await Promise.all([
      getEmailSettings(adminDb, auth.businessId),
      listCards(adminDb, auth.businessId),
      pickableKinds(adminDb, auth.businessId),
    ]);
    return json({
      available: true,
      enabled: settings.enabled,
      paused: settings.paused,
      cards,
      // Built-in types and the owner's own; "Do something else" offers the whole fixed list.
      kinds,
      actions: PICKABLE_EXAMPLES.map((action) => ({ action, label: actionLabel(action) })),
    });
  } catch {
    return json({ error: "Could not load Sophie's questions." }, 500);
  }
}
