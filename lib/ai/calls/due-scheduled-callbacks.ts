import type { Firestore } from "firebase-admin/firestore";
import { getIndexedQuery } from "@/lib/firebase/indexed-query";

/** Preserve the worker's six-call batch; future appointments never consume it. */
export async function loadDueScheduledCallbacks(db: Firestore, now: number) {
  const scheduled = db.collection("ai_scheduled_callbacks").where("status", "==", "SCHEDULED");
  const customerQuery = getIndexedQuery(
    "scheduled-callbacks",
    scheduled.where("scheduledAt", "<=", now).orderBy("scheduledAt", "asc").limit(6),
    scheduled.limit(500),
  );
  // A distinct pending state keeps older deployed customer-only workers from
  // rejecting owner alerts during a rolling deployment. Same worker/batch cap.
  const ownerScheduled = db.collection("ai_scheduled_callbacks").where("status", "==", "OWNER_SCHEDULED");
  const ownerQuery = process.env.AI_SOPHIE_OWNER_NOTIFICATIONS_ENABLED === "true"
    ? getIndexedQuery("owner-inspection-notifications",
      ownerScheduled.where("scheduledAt", "<=", now).orderBy("scheduledAt", "asc").limit(6), ownerScheduled.limit(500))
    : Promise.resolve(null);
  const numberScheduled=db.collection("ai_scheduled_callbacks").where("status","==","OWNER_NUMBER_SCHEDULED");
  const numberQuery=process.env.AI_OWNER_VOICE_SCHEDULED_CALLS_ENABLED==="true"
    ? getIndexedQuery("owner-number-scheduled-calls",numberScheduled.where("scheduledAt","<=",now).orderBy("scheduledAt","asc").limit(6),numberScheduled.limit(500))
    : Promise.resolve(null);
  const [snapshot, ownerSnapshot,numberSnapshot] = await Promise.all([customerQuery, ownerQuery,numberQuery]);
  return [...snapshot.docs, ...(ownerSnapshot?.docs ?? []),...(numberSnapshot?.docs??[])]
    .filter(doc => typeof doc.get("scheduledAt") === "number" && Number.isFinite(doc.get("scheduledAt")) && doc.get("scheduledAt") <= now)
    .sort((a, b) => a.get("scheduledAt") - b.get("scheduledAt"))
    .slice(0, 6);
}
