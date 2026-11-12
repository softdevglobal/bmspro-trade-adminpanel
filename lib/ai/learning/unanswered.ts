import "server-only";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { UNANSWERED_COLLECTION } from "../data/knowledge-sources";
import { redactPersonalData } from "./redact";

/**
 * Records a question Sophie could not answer, for owner review (Step 7 adds the
 * review UI). Stores redacted question text only — never transcripts or contacts.
 */
export async function recordUnansweredQuestion(businessId: string, question: string) {
  const text = redactPersonalData(question).slice(0, 300);
  if (text.length < 3) return;
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const id = createHash("sha256").update(`${businessId}\n${normalized}`).digest("hex");
  const ref = adminDb.collection(UNANSWERED_COLLECTION).doc(id);
  await adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current) {
      // Keep dismissed questions dismissed; only bump the counter.
      tx.update(ref, { count: FieldValue.increment(1), lastAskedAt: FieldValue.serverTimestamp() });
      return;
    }
    tx.set(ref, {
      businessId, question: text, count: 1, status: "open", answeredSourceId: null,
      firstAskedAt: FieldValue.serverTimestamp(), lastAskedAt: FieldValue.serverTimestamp(),
    });
  });
}
