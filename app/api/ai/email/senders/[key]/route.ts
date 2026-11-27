import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { removeSender } from "@/lib/ai/email/senders";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** DELETE ?list=private|blocked. Owner only; an entry of another business is "not found". */
export async function DELETE(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ error: "Sophie's email sorting isn't available yet." }, 404);
    const list = new URL(request.url).searchParams.get("list");
    if (list !== "private" && list !== "blocked") return json({ error: "Choose the private or blocked list." }, 400);
    const { key } = await params;
    return (await removeSender(adminDb, auth.businessId, list, key))
      ? json({ ok: true })
      : json({ error: "Sender not found." }, 404);
  } catch {
    return json({ error: "Could not remove the sender." }, 500);
  }
}
