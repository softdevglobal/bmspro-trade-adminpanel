import { listBills, listRecentDecisions } from "@/lib/ai/email/activity";
import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** What Sophie did with the owner's recent answers, and the bills she added. Owner only. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    const [decisions, bills] = await Promise.all([
      listRecentDecisions(adminDb, auth.businessId),
      listBills(adminDb, auth.businessId),
    ]);
    return json({ available: true, decisions, bills });
  } catch {
    return json({ error: "Could not load what Sophie did." }, 500);
  }
}
