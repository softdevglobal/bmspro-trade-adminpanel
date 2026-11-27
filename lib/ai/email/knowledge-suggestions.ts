import "server-only";

import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

import { KNOWLEDGE_SOURCES_COLLECTION } from "@/lib/ai/data/knowledge-sources";
import { redactPersonalData, scanKnowledgeText } from "@/lib/ai/learning/redact";

/**
 * A business fact in the owner's answer becomes a knowledge DRAFT, never a rule
 * (docs/sophie-email-learning-and-auto-reply.md §7.3): "Ignore it, we don't go out to Penrith" →
 * "We don't service Penrith", for the owner to publish on the AI knowledge page. Only the source is
 * new: an email answer instead of a call. It uses the knowledge pipeline as it is, so the usual
 * review flags apply and nothing is used until the owner publishes it.
 *
 * Only the owner's own fact is kept: contact details are removed, and no email text is attached.
 */

export const MAX_SUGGESTIONS_PER_BUSINESS = 200;

export type SuggestResult =
  | { ok: true; id: string; flags: string[]; existing: boolean }
  | { ok: false; status: number; error: string };

export const suggestionId = (businessId: string, fact: string) =>
  createHash("sha256").update(`${businessId}\nemail-fact\n${fact.toLowerCase()}`).digest("hex").slice(0, 40);

/** The same fact written twice is one draft. */
export async function suggestKnowledgeDraft(db: Firestore, input: { businessId: string; uid: string; fact: unknown }): Promise<SuggestResult> {
  const raw = typeof input.fact === "string" ? input.fact.replace(/\s+/g, " ").trim() : "";
  const fact = redactPersonalData(raw).slice(0, 300);
  if (fact.length < 10) return { ok: false, status: 400, error: "Write the fact in a full sentence, for example “We don't service Penrith”." };

  const collection = db.collection(KNOWLEDGE_SOURCES_COLLECTION);
  const ref = collection.doc(suggestionId(input.businessId, fact));
  const existing = await ref.get();
  if (existing.exists) return existing.data()?.businessId === input.businessId ? { ok: true, id: ref.id, flags: [], existing: true } : { ok: false, status: 409, error: "That fact is already saved." };
  const count = await collection.where("businessId", "==", input.businessId).count().get();
  if (count.data().count >= MAX_SUGGESTIONS_PER_BUSINESS) return { ok: false, status: 400, error: "Knowledge entry limit reached." };

  const title = (fact.length > 60 ? `${fact.slice(0, 59).trimEnd()}…` : fact).replace(/[.\s]+$/, "");
  const flags = scanKnowledgeText(`${title}\n${fact}`);
  await ref.set({
    businessId: input.businessId, kind: "note", title, body: fact, generated: false,
    // Always a draft, or "needs review" when flagged, like any owner entry (the owner publishes it).
    status: flags.length ? "needs_review" : "draft", flags,
    source: "email_decision",
    version: 1, indexedVersion: 0, chunkCount: 0, indexError: null,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: input.uid,
  });
  return { ok: true, id: ref.id, flags, existing: false };
}
