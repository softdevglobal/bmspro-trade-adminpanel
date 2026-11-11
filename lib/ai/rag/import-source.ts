/**
 * Saves text read from a file or web page as a knowledge entry, the same way typed
 * entries are saved: scanned for risky content, stored as a draft (or needs_review
 * when flagged), then indexed by the caller in the background. Never auto-published.
 */
import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import {
  KNOWLEDGE_SOURCES_COLLECTION, KnowledgeError, cutAtLine, type KnowledgeOrigin,
} from "../data/knowledge-sources";
import { scanKnowledgeText } from "../learning/redact";
import { purposeError, type KnowledgePurpose } from "../data/knowledge-purpose";

const MAX_SOURCES_PER_BUSINESS = 200;

export async function createImportedSource(
  owner: { businessId: string; uid: string },
  input: { kind: "document" | "website"; title: string; text: string; origin: KnowledgeOrigin; purpose: KnowledgePurpose; purposeNote?: string },
) {
  const purposeNote = input.purposeNote?.trim() ?? "";
  const invalidPurpose = purposeError(input.purpose, purposeNote);
  if (invalidPurpose) throw new KnowledgeError(400, invalidPurpose);
  const text = input.text.trim();
  if (text.length < 10) throw new KnowledgeError(422, "No text found. Scanned PDFs and picture-only slides aren't supported yet.");
  const title = input.title.trim().slice(0, 120) || "Imported document";
  // Over the limit: keep whole lines only, so a product row is never half-saved.
  const body = cutAtLine(text);
  const truncated = body.length < text.length;

  const collection = adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION);
  const count = await collection.where("businessId", "==", owner.businessId).count().get();
  if (count.data().count >= MAX_SOURCES_PER_BUSINESS) throw new KnowledgeError(400, "Knowledge entry limit reached.");

  // The note is read by Sophie too, so it is scanned like the text.
  const flags = scanKnowledgeText(`${title}\n${purposeNote}\n${body}`);
  const ref = collection.doc();
  await ref.set({
    businessId: owner.businessId, kind: input.kind, title, body, generated: false,
    origin: input.origin, truncated, purpose: input.purpose, purposeNote,
    status: flags.length ? "needs_review" : "draft", flags,
    version: 1, indexedVersion: 0, chunkCount: 0, indexError: null,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: owner.uid,
  });
  return { id: ref.id, flags, truncated };
}

/** Index an entry after the response is sent. */
export async function indexInBackground(sourceId: string, stage: string) {
  try { await (await import("./ingest")).indexKnowledgeSource(sourceId); }
  catch { console.error("[ai-knowledge] Indexing failed", { stage }); }
}

/** 20 imports per business per hour: each import costs embedding calls. */
export async function allowImport(businessId: string): Promise<boolean> {
  const { consumeRateLimits } = await import("@/lib/security/rate-limit");
  return consumeRateLimits([{ key: `ai-knowledge-import:${businessId}`, limit: 20, windowMs: 3600_000 }]);
}
