import "server-only";
import { knowledgeSettings, type KnowledgeSettings } from "./settings";

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const BATCH = 64;

/** OpenAI embeddings over fetch. Never logs inputs or provider responses. */
export function createEmbedder(settings: KnowledgeSettings = knowledgeSettings(), fetcher: typeof fetch = fetch): EmbedFn {
  return async texts => {
    if (!settings.apiKey) throw new Error("Embeddings are not configured.");
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH) {
      const batch = texts.slice(start, start + BATCH);
      const response = await fetcher("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
        // `dimensions` is supported by the text-embedding-3 family. Remove it for models that don't support it.
        body: JSON.stringify({ model: settings.model, input: batch, dimensions: settings.dimensions }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Embedding request failed (HTTP ${response.status}).`);
      const json = await response.json() as { data?: { index: number; embedding: number[] }[] };
      const data = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
      if (data.length !== batch.length || data.some(item => !Array.isArray(item.embedding) || item.embedding.length !== settings.dimensions)) {
        throw new Error("Embedding response is invalid.");
      }
      vectors.push(...data.map(item => item.embedding));
    }
    return vectors;
  };
}
