import { dismissStyleSuggestion } from "@/lib/ai/email/style-learning";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

/**
 * DELETE "Not now" on the suggested greeting and sign-off (§8.5): Sophie asks again only after more
 * of the owner's emails. Using the suggestion is a normal save of the style in settings. Owner only.
 */
export async function DELETE(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    if (!emailTriageAvailable()) return Response.json({ error: "Sophie's email sorting isn't available yet." }, { status: 404 });
    await dismissStyleSuggestion(adminDb, auth.businessId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Could not save your answer." }, { status: 500 });
  }
}
