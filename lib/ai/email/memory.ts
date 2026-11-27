import "server-only";

import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";

import { redactPersonalData, scanKnowledgeText } from "@/lib/ai/learning/redact";

import type { EmailKind, ExampleHit } from "./types";

/**
 * Sophie's email memory (docs/sophie-email-learning-and-auto-reply.md §7.2): past emails of one
 * business with the owner's decision, found by meaning. It helps Sophie guess ("dynamic few-shot")
 * and gives a second opinion (the kNN vote). It never gives permission: only approved rules do.
 */

export const EMAIL_EXAMPLES_COLLECTION = "ai_email_examples";
export const NEAREST_EXAMPLES = 5;
/** Cosine distance beyond which a past email isn't "like this one". A proposal: tune in shadow mode. */
export const MAX_EXAMPLE_DISTANCE = 0.5;
/** "The cases agree" when at least this many of the 5 nearest share the type and the actions. */
export const AGREEMENT_NEEDED = 4;
const SUMMARY_MAX = 300;

/**
 * The text embedded for an email: the subject and its opening, with contact details removed.
 * Only the vector is kept, never this text.
 */
export function memoryText(subject: string, body: string): string {
  const opening = body.replace(/\s+/g, " ").trim().slice(0, 600);
  return redactPersonalData(`${subject.trim()}\n${opening}`).slice(0, 800);
}

type ExampleDoc = { id: string; get(field: string): unknown };

/** Defence in depth: never trust the query alone for tenant isolation (T12). */
export function toExampleHits(docs: readonly ExampleDoc[], businessId: string): ExampleHit[] {
  return docs
    .filter((doc) => doc.get("businessId") === businessId && doc.get("status") === "active")
    .map((doc) => ({
      id: doc.id,
      kind: String(doc.get("kind")) as EmailKind,
      summary: String(doc.get("summary") ?? ""),
      actionsKey: String(doc.get("actionsKey") ?? ""),
      distance: Number(doc.get("distance")),
    }));
}

/** The kNN vote: at least 4 of the 5 nearest past emails got the same type and the same actions. */
export function examplesAgree(hits: readonly ExampleHit[]): boolean {
  const nearest = hits.slice(0, NEAREST_EXAMPLES);
  if (nearest.length < AGREEMENT_NEEDED) return false;
  const counts = new Map<string, number>();
  for (const hit of nearest) {
    const key = `${hit.kind}\n${hit.actionsKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) >= AGREEMENT_NEEDED;
}

export type NewExample = {
  businessId: string;
  /** One example per owner decision; the decision id is the doc id, so saving twice is harmless. */
  decisionId: string;
  kind: EmailKind;
  /** Hashed sender, for narrow rules. */
  senderKey: string;
  summary: string;
  actionsKey: string;
  vector: number[];
  embeddingModel: string;
};

export function createEmailMemory(db: Firestore) {
  const collection = db.collection(EMAIL_EXAMPLES_COLLECTION);
  return {
    /** The 5 nearest active examples of this business. Each result is checked for the business again. */
    async nearest(businessId: string, vector: number[], limit = NEAREST_EXAMPLES): Promise<ExampleHit[]> {
      const snapshot = await collection
        .select("businessId", "status", "kind", "summary", "actionsKey", "distance")
        .where("businessId", "==", businessId)
        .where("status", "==", "active")
        .findNearest({
          vectorField: "embedding",
          queryVector: vector,
          limit,
          distanceMeasure: "COSINE",
          distanceResultField: "distance",
          distanceThreshold: MAX_EXAMPLE_DISTANCE,
        })
        .get();
      return toExampleHits(snapshot.docs, businessId);
    },

    /**
     * Saves one decided email. Summaries are redacted again, and any that still look like they
     * hold personal data or instructions are not saved (§7.2). Returns the id, or null.
     */
    async save(example: NewExample, now = Date.now()): Promise<string | null> {
      const summary = redactPersonalData(example.summary.replace(/\s+/g, " ").trim()).slice(0, SUMMARY_MAX);
      if (!summary || scanKnowledgeText(summary).length > 0 || !/^[\w-]{1,100}$/.test(example.decisionId)) return null;
      await collection.doc(example.decisionId).set({
        businessId: example.businessId,
        kind: example.kind,
        senderKey: example.senderKey,
        summary,
        actionsKey: example.actionsKey,
        decisionId: example.decisionId,
        embedding: FieldValue.vector(example.vector),
        embeddingModel: example.embeddingModel,
        status: "active",
        createdAt: Timestamp.fromMillis(now),
      });
      return example.decisionId;
    },

    /** After an undo or a correction the example is no longer used (§7.2). */
    async retire(businessId: string, exampleId: string, now = Date.now()): Promise<boolean> {
      if (!/^[\w-]{1,100}$/.test(exampleId)) return false;
      const ref = collection.doc(exampleId);
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.businessId !== businessId) return false;
      await ref.set({ status: "retired", retiredAt: Timestamp.fromMillis(now) }, { merge: true });
      return true;
    },
  };
}

export type EmailMemory = ReturnType<typeof createEmailMemory>;
