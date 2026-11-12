import "server-only";

export type KnowledgeSettings = {
  enabled: boolean;
  apiKey: string;
  model: string;
  dimensions: number;
  topK: number;
  maxDistance: number;
};

/** Reads and validates RAG settings. Throws on a broken configuration. */
export function knowledgeSettings(env: Readonly<Record<string, string | undefined>> = process.env): KnowledgeSettings {
  const dimensions = Number(env.AI_KNOWLEDGE_EMBEDDING_DIMENSIONS || 1536);
  const topK = Number(env.AI_KNOWLEDGE_TOP_K || 4);
  // 0.60 measured best with text-embedding-3-small (scripts/eval-ai-knowledge.ts):
  // 0.55 missed 1 in 6 answers; above ~0.63 unrelated passages start to come back.
  const maxDistance = Number(env.AI_KNOWLEDGE_MAX_DISTANCE || 0.6);
  if (!Number.isInteger(dimensions) || dimensions < 256 || dimensions > 2048) {
    throw new Error("AI_KNOWLEDGE_EMBEDDING_DIMENSIONS must be an integer from 256 to 2048.");
  }
  if (!Number.isInteger(topK) || topK < 1 || topK > 8) {
    throw new Error("AI_KNOWLEDGE_TOP_K must be an integer from 1 to 8.");
  }
  if (!Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance >= 2) {
    throw new Error("AI_KNOWLEDGE_MAX_DISTANCE must be between 0 and 2 (cosine distance).");
  }
  return {
    enabled: env.AI_VOICE_KNOWLEDGE_ENABLED === "true",
    apiKey: env.OPENAI_API_KEY?.trim() ?? "",
    model: env.AI_KNOWLEDGE_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    dimensions,
    topK,
    maxDistance,
  };
}
