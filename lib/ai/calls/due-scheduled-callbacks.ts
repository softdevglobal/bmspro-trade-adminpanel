import type { Firestore } from "firebase-admin/firestore";
import { getIndexedQuery } from "@/lib/firebase/indexed-query";

/** Preserve the worker's six-call batch; future appointments never consume it. */
export async function loadDueScheduledCallbacks(db: Firestore, now: number) {
  const scheduled = db.collection("ai_scheduled_callbacks").where("status", "==", "SCHEDULED");
  const snapshot = await getIndexedQuery(
    "scheduled-callbacks",
    scheduled.where("scheduledAt", "<=", now).orderBy("scheduledAt", "asc").limit(6),
    scheduled.limit(500),
  );
  return snapshot.docs
    .filter(doc => typeof doc.get("scheduledAt") === "number" && Number.isFinite(doc.get("scheduledAt")) && doc.get("scheduledAt") <= now)
    .sort((a, b) => a.get("scheduledAt") - b.get("scheduledAt"))
    .slice(0, 6);
}
