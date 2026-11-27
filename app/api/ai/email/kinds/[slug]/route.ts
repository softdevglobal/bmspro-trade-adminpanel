import { removeCustomKind } from "@/lib/ai/email/kinds";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** DELETE one of the owner's own types. Sophie stops sorting into it; past answers keep it. Owner only. */
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const { slug } = await params;
    return (await removeCustomKind(adminDb, auth.businessId, `custom:${slug}`))
      ? json({ ok: true })
      : json({ error: "Type not found." }, 404);
  } catch {
    return json({ error: "Could not remove the type." }, 500);
  }
}
