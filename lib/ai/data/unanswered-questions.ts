import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { UNANSWERED_COLLECTION } from "./knowledge-sources";

export type UnansweredQuestion = { id: string; question: string; count: number; lastAskedAt: number | null };

const millis = (value: unknown) =>
  typeof (value as { toMillis?: () => number })?.toMillis === "function" ? (value as { toMillis: () => number }).toMillis() : null;

/** Open questions for one business, most-asked first. Text is already redacted. */
export async function listOpenUnansweredQuestions(businessId: string, limit = 50): Promise<UnansweredQuestion[]> {
  const snapshot = await adminDb.collection(UNANSWERED_COLLECTION)
    .where("businessId", "==", businessId).where("status", "==", "open").orderBy("count", "desc").limit(limit).get();
  return snapshot.docs.map(doc => ({
    id: doc.id,
    question: String(doc.get("question") ?? ""),
    count: Number(doc.get("count") ?? 1),
    lastAskedAt: millis(doc.get("lastAskedAt")),
  }));
}
