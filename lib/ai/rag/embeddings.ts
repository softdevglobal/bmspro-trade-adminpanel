// Marks this module as server-only: Next.js will error if it is imported into client
import "server-only";
// Import the settings loader its type(api key,model name,vector dimensions)
import { knowledgeSettings, type KnowledgeSettings } from "./settings";
// An embedder takes a list of texts and returns one vector per text
export type EmbedFn = (texts: string[]) => Promise<number[][]>;
// Max number of texts sent to OpenAI in one request
const BATCH = 64;

export type EmbedOptions = {
  /** Per-request timeout. Indexing can wait; a phone call cannot. */
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error, 429 or 5xx. */
  retries?: number;
  /** How many batches run at the same time (indexing large imports). */
  concurrency?: number;
};

class RetryableError extends Error {}

/** OpenAI embeddings over fetch. Never logs inputs or provider responses. */
// Factory that builds an embed function.
// `settings` and `fetcher` have defaults, but can be overridden (handy for tests/mocking)
export function createEmbedder(
  settings: KnowledgeSettings = knowledgeSettings(),
  fetcher: typeof fetch = fetch,
  { timeoutMs = 20_000, retries = 1, concurrency = 3 }: EmbedOptions = {},
): EmbedFn {
  const embedBatch = async (batch: string[]): Promise<number[][]> => {
    for (let attempt = 0; ; attempt++) {
      try {
        let response: Response;
        try {
          response = await fetcher("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
            // `dimensions` is supported by the text-embedding-3 family. Remove it for models that don't support it.
            body: JSON.stringify({ model: settings.model, input: batch, dimensions: settings.dimensions }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch {
          throw new RetryableError("Embedding request timed out or could not connect.");
        }
        if (response.status === 429 || response.status >= 500) throw new RetryableError(`Embedding request failed (HTTP ${response.status}).`);
        if (!response.ok) throw new Error(`Embedding request failed (HTTP ${response.status}).`);
        const json = await response.json() as { data?: { index: number; embedding: number[] }[] };
        const data = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
        if (data.length !== batch.length || data.some(item => !Array.isArray(item.embedding) || item.embedding.length !== settings.dimensions)) {
          throw new Error("Embedding response is invalid.");
        }
        return data.map(item => item.embedding);
      } catch (error) {
        if (!(error instanceof RetryableError) || attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  };

  return async texts => {
    if (!settings.apiKey) throw new Error("Embeddings are not configured.");
    const batches: string[][] = [];
    for (let start = 0; start < texts.length; start += BATCH) batches.push(texts.slice(start, start + BATCH));
    // Keep result order while running a few batches at once.
    const results: number[][][] = new Array(batches.length);
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const index = next++;
        results[index] = await embedBatch(batches[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), batches.length) }, worker));
    return results.flat();
  };
}

/**
 * Question embedder for live calls and the dashboard test search: short timeout,
 * one quick retry, and an in-memory cache so a question asked again on this
 * server instance skips the OpenAI round trip (about 0.4–0.7 s, more when cold).
 * Only the question text is cached, never caller details or business data.
 */
const QUERY_CACHE_MAX = 500;
const QUERY_CACHE_TTL_MS = 6 * 60 * 60_000;
const queryCache = new Map<string, { vector: number[]; expiresAt: number }>();

export function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/[^\p{L}\p{N}$%]+/gu, " ").trim();
}

export function clearQueryEmbeddingCache() { queryCache.clear(); }

export function createQueryEmbedder(
  settings: KnowledgeSettings = knowledgeSettings(),
  fetcher: typeof fetch = fetch,
  { timeoutMs = 3_500, retries = 1 }: Pick<EmbedOptions, "timeoutMs" | "retries"> = {},
): EmbedFn {
  const embed = createEmbedder(settings, fetcher, { timeoutMs, retries, concurrency: 1 });
  const keyFor = (text: string) => `${settings.model}:${settings.dimensions}:${normalizeQuestion(text)}`;
  return async texts => {
    const now = Date.now();
    const vectors: (number[] | undefined)[] = texts.map(text => {
      const hit = queryCache.get(keyFor(text));
      if (!hit || hit.expiresAt <= now) return undefined;
      // Refresh recency so frequently asked questions stay cached.
      queryCache.delete(keyFor(text));
      queryCache.set(keyFor(text), hit);
      return hit.vector;
    });
    const missing = texts.filter((_, index) => !vectors[index]);
    if (missing.length) {
      const fresh = await embed(missing);
      let cursor = 0;
      texts.forEach((text, index) => {
        if (vectors[index]) return;
        const vector = fresh[cursor++];
        vectors[index] = vector;
        queryCache.set(keyFor(text), { vector, expiresAt: now + QUERY_CACHE_TTL_MS });
      });
      while (queryCache.size > QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
    }
    return vectors as number[][];
  };
}
