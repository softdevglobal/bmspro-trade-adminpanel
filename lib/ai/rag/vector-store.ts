// Server-only guard: build fails if this is imported into client code
import "server-only";
// FieldValue gives vector fields and server timestamps; Firestore is the DB type
import { FieldValue, type Firestore } from "firebase-admin/firestore";
// Name of the chunks collection, and the allowed "kind" values
import { KNOWLEDGE_CHUNKS_COLLECTION, type KnowledgeKind } from "../data/knowledge-sources";
// Types for chunk status (draft/published), a chunk to save, and a search result
import type { ChunkStatus, ChunkToStore, KnowledgePassage } from "../data/knowledge-chunks";

// Everything needed to replace one source's chunks
export type ReplaceChunksInput = {
  businessId: string;      // tenant that owns the source
  sourceId: string;        // which source the chunks came from
  sourceTitle: string;     // title copied onto every chunk
  kind: KnowledgeKind;     // type of source
  sourceVersion: number;   // version of the source these chunks were built from
  status: ChunkStatus;     // draft or published
  model: string;           // embedding model that made the vectors
  chunks: ChunkToStore[];  // the chunks (ordinal, text, embedding)
};

/**
 * Published passages per business for keyword matching, kept for a minute on this
 * server so a call's lookups don't re-read them. A newly published entry becomes
 * keyword-searchable within that minute (search by meaning sees it at once).
 */
const KEYWORD_CACHE_TTL_MS = 60_000;
const KEYWORD_MAX_PASSAGES = 8000;
const keywordCache = new Map<string, { passages: KnowledgePassage[]; expiresAt: number }>();
export function clearKeywordCache(businessId?: string) {
  if (businessId) keywordCache.delete(businessId); else keywordCache.clear();
}

// Factory: builds the store around a Firestore instance (easy to swap in tests)
export function createVectorStore(db: Firestore) {
  // The collection that holds all chunk documents
  const collection = db.collection(KNOWLEDGE_CHUNKS_COLLECTION);
  // Helper: query for all chunks of one source
  const bySource = (sourceId: string) => collection.where("sourceId", "==", sourceId);

  return {
    /** Writes the new version first, then removes only OLDER versions. */
    async replaceSourceChunks(input: ReplaceChunksInput) {
      // BulkWriter batches many writes efficiently, with automatic retries
      const writer = db.bulkWriter();
      for (const chunk of input.chunks) {
        // Deterministic doc id (source + version + ordinal), so re-running the same version overwrites, not duplicates
        void writer.set(collection.doc(`${input.sourceId}_${input.sourceVersion}_${chunk.ordinal}`), {
          businessId: input.businessId,                    // used for tenant filtering
          sourceId: input.sourceId,
          sourceTitle: input.sourceTitle,
          kind: input.kind,
          sourceVersion: input.sourceVersion,
          ordinal: chunk.ordinal,                          // position of chunk within the source
          text: chunk.text,                                // chunk text (title + content)
          embedding: FieldValue.vector(chunk.embedding),   // stored as a Firestore vector field
          embeddingModel: input.model,                     // lets you spot stale vectors later
          status: input.status,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      // Wait until every new chunk is written
      await writer.close();

      // Now look at everything stored for this source (new and old)
      const existing = await bySource(input.sourceId).get();
      // Separate writer for deletions
      const deleter = db.bulkWriter();
      for (const doc of existing.docs) {
        const version = Number(doc.get("sourceVersion"));
        // Same version with a higher ordinal = leftover from a longer earlier run of this version.
        const staleOrdinal = version === input.sourceVersion && Number(doc.get("ordinal")) >= input.chunks.length;
        // Delete older versions and stale leftovers; never touch newer versions
        if (version < input.sourceVersion || staleOrdinal) void deleter.delete(doc.ref);
      }
      // Wait for deletions to finish
      await deleter.close();
      clearKeywordCache(input.businessId);
    },

    /** Publish / unpublish without re-embedding. */
    async setSourceStatus(sourceId: string, status: ChunkStatus) {
      // Find all chunks of the source
      const existing = await bySource(sourceId).get();
      const writer = db.bulkWriter();
      // Flip only the status field; vectors are untouched, so no embedding cost
      for (const doc of existing.docs) void writer.update(doc.ref, { status, updatedAt: FieldValue.serverTimestamp() });
      await writer.close();
      // Published passages changed: keyword matching must see it on the next search.
      for (const businessId of new Set(existing.docs.map(doc => String(doc.get("businessId"))))) clearKeywordCache(businessId);
    },

    // Removes every chunk of a source (used when it is archived)
    async deleteSource(sourceId: string) {
      const existing = await bySource(sourceId).get();
      const writer = db.bulkWriter();
      for (const doc of existing.docs) void writer.delete(doc.ref);
      await writer.close();
      for (const businessId of new Set(existing.docs.map(doc => String(doc.get("businessId"))))) clearKeywordCache(businessId);
    },

    /** Text of every published passage for one business (no vectors), for keyword matching. */
    async publishedPassages(businessId: string): Promise<KnowledgePassage[]> {
      const cached = keywordCache.get(businessId);
      if (cached && cached.expiresAt > Date.now()) return cached.passages;
      const snapshot = await collection
        .select("businessId", "status", "sourceId", "sourceTitle", "kind", "text")
        .where("businessId", "==", businessId)
        .where("status", "==", "published")
        .limit(KEYWORD_MAX_PASSAGES)
        .get();
      const passages = snapshot.docs
        .filter(doc => doc.get("businessId") === businessId && doc.get("status") === "published")
        .map(doc => ({
          sourceId: String(doc.get("sourceId")),
          sourceTitle: String(doc.get("sourceTitle")),
          kind: doc.get("kind") as KnowledgeKind,
          text: String(doc.get("text")),
          distance: 0,
        }));
      if (keywordCache.size > 200) keywordCache.clear();
      keywordCache.set(businessId, { passages, expiresAt: Date.now() + KEYWORD_CACHE_TTL_MS });
      return passages;
    },

    /** Tenant-filtered similarity search. businessId always comes from the server-side binding. */
    async nearest(businessId: string, vector: number[], limit: number, maxDistance: number): Promise<KnowledgePassage[]> {
      const snapshot = await collection
        // Return only what we use. Without this each match also carries its full
        // embedding (about 30 KB per match). "distance" must be listed to be kept.
        .select("businessId", "status", "sourceId", "sourceTitle", "kind", "text", "distance")
        .where("businessId", "==", businessId)          // only this business's chunks
        .where("status", "==", "published")             // only approved chunks
        .findNearest({
          vectorField: "embedding",                     // field holding the vectors
          queryVector: vector,                          // the embedded question
          limit,                                        // max number of results
          distanceMeasure: "COSINE",                    // compare by cosine distance (0 = identical direction)
          distanceResultField: "distance",              // write the distance into each result doc
          distanceThreshold: maxDistance,               // drop anything farther than this
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
          distance: Number(doc.get("distance")),        // lower = more similar
        }));
    },
  };
}

// Type of the store object, so other files can declare it as a dependency
export type VectorStore = ReturnType<typeof createVectorStore>;