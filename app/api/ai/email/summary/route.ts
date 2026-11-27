import { emailTriageAvailable } from "@/lib/ai/email/settings";
import { EMAIL_SUMMARIES_COLLECTION } from "@/lib/ai/email/summary";
import { requireSophieOwner } from "@/lib/ai/owner-call/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

/** The latest daily summary for the owner's business, or null before the first one. Owner only. */
export async function GET(request: Request) {
  try {
    const auth = await requireSophieOwner(request);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!emailTriageAvailable()) return json({ available: false });
    const snap = await adminDb.collection(EMAIL_SUMMARIES_COLLECTION)
      .where("businessId", "==", auth.businessId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    const doc = snap.docs[0];
    const data = doc?.data();
    return json({ available: true, summary: data && data.businessId === auth.businessId ? data.summary ?? null : null });
  } catch {
    return json({ error: "Could not load the summary." }, 500);
  }
}
