import { platformTodayIso } from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { getIndexedQuery } from "@/lib/firebase/indexed-query";
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
  const date = new URL(request.url).searchParams.get("date") ?? platformTodayIso();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(date) ? zonedDateTimeToUtcMs(date, "00:00") : null;
  const endMinute = start !== null ? zonedDateTimeToUtcMs(date, "23:59") : null;
  if (start === null || endMinute === null || platformTodayIso(new Date(start)) !== date) {
    return json({ error: "Choose a valid scheduled date." }, 400);
  }
  const end = endMinute + 60_000;
  try {
    const base = adminDb.collection("ai_scheduled_callbacks").where("businessId", "==", auth.businessId);
    const snapshot = await getIndexedQuery("scheduled-call-history",
      base.where("scheduledAt", ">=", start).where("scheduledAt", "<", end)
        .orderBy("scheduledAt", "desc").limit(100), base.limit(100));
    const calls = snapshot.docs.filter(doc => {
      const at = doc.get("scheduledAt");
      return typeof at === "number" && at >= start && at < end;
    }).map(doc => {
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
