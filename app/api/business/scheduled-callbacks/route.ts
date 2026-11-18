import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: object, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

const statuses = new Set(["SCHEDULED", "CALLING", "ANSWERED", "NO_ANSWER", "FAILED", "CANCELLED", "SKIPPED", "UNKNOWN"]);

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    const snapshot = await adminDb.collection("ai_scheduled_callbacks")
      .where("businessId", "==", auth.businessId).limit(100).get();
    const calls = snapshot.docs.map(doc => {
      const data = doc.data();
      const digits = typeof data.number === "string" ? data.number.replace(/\D/g, "") : "";
      const status = typeof data.status === "string" && statuses.has(data.status) ? data.status : "FAILED";
      return {
        id: doc.id,
        status,
        scheduledAt: typeof data.scheduledAt === "number" ? data.scheduledAt : null,
        attemptedAt: typeof data.attemptedAt === "number" ? data.attemptedAt : null,
        completedAt: typeof data.completedAt === "number" ? data.completedAt : null,
        customerName: typeof data.customerName === "string" ? data.customerName : null,
        callerLastFour: digits.length >= 4 ? digits.slice(-4) : null,
        did: typeof data.did === "string" ? data.did : null,
        purpose: data.purpose === "overdue_invoice" ? "Overdue invoice" : "Missed-call follow-up",
        reason: typeof data.reason === "string" ? data.reason : null,
      };
    }).sort((a, b) => (b.scheduledAt ?? 0) - (a.scheduledAt ?? 0));
    return json({ calls });
  } catch {
    return json({ error: "Could not load scheduled calls." }, 503);
  }
}
