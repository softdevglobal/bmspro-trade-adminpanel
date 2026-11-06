import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { KNOWLEDGE_SOURCES_COLLECTION, KnowledgeError, UNANSWERED_COLLECTION } from "../data/knowledge-sources";
import { scanKnowledgeText } from "./redact";

export const unansweredAnswer = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  answer: z.string().trim().min(10).max(20_000),
}).strict();

/**
 * Turns the owner's answer into a FAQ entry. It is published straight away
 * (the owner wrote it), unless the scan flags it, in which case it waits in
 * needs_review. Returns the new entry id; the caller indexes it after responding.
 */
export async function answerUnansweredQuestion(businessId: string, questionId: string, uid: string, input: z.infer<typeof unansweredAnswer>) {
  const questionRef = adminDb.collection(UNANSWERED_COLLECTION).doc(questionId);
  const sourceRef = adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION).doc();
  return adminDb.runTransaction(async tx => {
    const question = (await tx.get(questionRef)).data();
    if (!question || question.businessId !== businessId || question.status !== "open") throw new KnowledgeError(404, "Question not found.");
    const title = input.title ?? String(question.question).replace(/\?*$/, "?").slice(0, 120);
    const flags = scanKnowledgeText(`${title}\n${input.answer}`);
    const status = flags.length ? "needs_review" : "published";
    tx.set(sourceRef, {
      businessId, kind: "faq", title, body: input.answer, generated: false, status, flags,
      version: 1, indexedVersion: 0, chunkCount: 0, indexError: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid,
      ...(status === "published" ? { publishedAt: FieldValue.serverTimestamp(), publishedBy: uid } : {}),
      fromUnansweredId: questionId,
    });
    tx.update(questionRef, { status: "answered", answeredSourceId: sourceRef.id, answeredAt: FieldValue.serverTimestamp(), answeredBy: uid });
    return { sourceId: sourceRef.id, status, flags };
  });
}

export async function dismissUnansweredQuestion(businessId: string, questionId: string, uid: string) {
  const ref = adminDb.collection(UNANSWERED_COLLECTION).doc(questionId);
  await adminDb.runTransaction(async tx => {
    const question = (await tx.get(ref)).data();
    if (!question || question.businessId !== businessId) throw new KnowledgeError(404, "Question not found.");
    tx.update(ref, { status: "dismissed", dismissedAt: FieldValue.serverTimestamp(), dismissedBy: uid });
  });
}
