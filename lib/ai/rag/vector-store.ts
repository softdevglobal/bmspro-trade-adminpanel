import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { KNOWLEDGE_CHUNKS_COLLECTION, type KnowledgeKind } from "../data/knowledge-sources";
import type { ChunkStatus, ChunkToStore, KnowledgePassage } from "../data/knowledge-chunks";

export type ReplaceChunksInput = {
  businessId: string;
  sourceId: string;
  sourceTitle: string;
  kind: KnowledgeKind;
  sourceVersion: number;
  status: ChunkStatus;
  model: string;
  chunks: ChunkToStore[];
};

export function createVectorStore(db: Firestore) {
  const collection = db.collection(KNOWLEDGE_CHUNKS_COLLECTION);
  const bySource = (sourceId: string) => collection.where("sourceId", "==", sourceId);

  return {
    /** Writes the new version first, then removes only OLDER versions. */
    async replaceSourceChunks(input: ReplaceChunksInput) {
      const writer = db.bulkWriter();
      for (const chunk of input.chunks) {
        void writer.set(collection.doc(`${input.sourceId}_${input.sourceVersion}_${chunk.ordinal}`), {
          businessId: input.businessId,
          sourceId: input.sourceId,
          sourceTitle: input.sourceTitle,
          kind: input.kind,
          sourceVersion: input.sourceVersion,
          ordinal: chunk.ordinal,
          text: chunk.text,
          embedding: FieldValue.vector(chunk.embedding),
          embeddingModel: input.model,
          status: input.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await writer.close();

      const existing = await bySource(input.sourceId).get();
      const deleter = db.bulkWriter();
      for (const doc of existing.docs) {
        const version = Number(doc.get("sourceVersion"));
        // Same version with a higher ordinal = leftover from a longer earlier run of this version.
        const staleOrdinal = version === input.sourceVersion && Number(doc.get("ordinal")) >= input.chunks.length;
        if (version < input.sourceVersion || staleOrdinal) void deleter.delete(doc.ref);
      }
      await deleter.close();
    },

    /** Publish / unpublish without re-embedding. */
    async setSourceStatus(sourceId: string, status: ChunkStatus) {
      const existing = await bySource(sourceId).get();
      const writer = db.bulkWriter();
      for (const doc of existing.docs) void writer.update(doc.ref, { status, updatedAt: FieldValue.serverTimestamp() });
      await writer.close();
    },

    async deleteSource(sourceId: string) {
      const existing = await bySource(sourceId).get();
      const writer = db.bulkWriter();
      for (const doc of existing.docs) void writer.delete(doc.ref);
      await writer.close();
    },

    /** Tenant-filtered similarity search. businessId always comes from the server-side binding. */
    async nearest(businessId: string, vector: number[], limit: number, maxDistance: number): Promise<KnowledgePassage[]> {
      const snapshot = await collection
        .where("businessId", "==", businessId)
        .where("status", "==", "published")
        .findNearest({
          vectorField: "embedding",
          queryVector: vector,
          limit,
          distanceMeasure: "COSINE",
          distanceResultField: "distance",
          distanceThreshold: maxDistance,
        })
        .get();
      return snapshot.docs
        // Defence in depth: never trust the index alone for tenant isolation.
        .filter(doc => doc.get("businessId") === businessId && doc.get("status") === "published")
        .map(doc => ({
          sourceId: String(doc.get("sourceId")),
          sourceTitle: String(doc.get("sourceTitle")),
          kind: doc.get("kind") as KnowledgeKind,
          text: String(doc.get("text")),
          distance: Number(doc.get("distance")),
        }));
    },
  };
}

export type VectorStore = ReturnType<typeof createVectorStore>;
