import { knowledgeQuestionArguments, type ScheduleVoiceTask } from "./action-schemas";
import { nearMissDistance, packagePassages, searchPassages, type KnowledgeResult, type RetrieverDependencies, type SearchStats } from "../../rag/retriever";
import type { KnowledgeSearchSource } from "../../rag/search-log";

/**
 * The business to search. Phone calls pass their full DID binding; the owner
 * call passes the business from the owner's login. Only businessId is used.
 */
export type KnowledgeBinding = { businessId: string };

export type KnowledgeToolOptions = {
  /** Record NO_MATCH questions for the Unanswered page. Owner calls pass false. */
  recordUnanswered?: boolean;
  /** Who searched, stored on the search log. */
  source?: KnowledgeSearchSource;
};

export interface VoiceKnowledgeDependencies extends RetrieverDependencies {
  enabled(): boolean;
  business(): Promise<Record<string, unknown>>;
  unanswered(question: string): void;
  /** Optional: records timings and matches after the response. Must never throw. */
  logSearch?(entry: { question: string; status: "FOUND" | "NO_MATCH"; passagesSent: number; stats: SearchStats }): void;
}

/** Pure tool logic; dependencies are injected so tests need no Firestore or OpenAI. */
export function knowledgeActions(binding: KnowledgeBinding, deps: VoiceKnowledgeDependencies) {
  return {
    search: async (raw: unknown): Promise<KnowledgeResult> => {
      if (!deps.enabled()) {
        return { status: "NO_MATCH", passages: [], message: "Business knowledge is not available. Do not guess." };
      }
      const parsed = knowledgeQuestionArguments.safeParse(raw);
      if (!parsed.success) {
        return { status: "REJECTED", passages: [], message: "Ask one short question about this business." };
      }
      const question = parsed.data.question;
      // The business check runs alongside the search to save a round trip. If the
      // business became inactive it throws, Promise.all rejects and no passages
      // are returned (the tool reports UNAVAILABLE).
      const [, found] = await Promise.all([deps.business(), searchPassages(deps, binding.businessId, question)]);
      const result = packagePassages(found.hits);
      if (result.status === "NO_MATCH") deps.unanswered(question);
      if (result.status !== "REJECTED") {
        try { deps.logSearch?.({ question, status: result.status, passagesSent: result.passages.length, stats: found.stats }); }
        catch { /* Logging must never break a call. */ }
      }
      return result;
    },
  };
}

export async function createVoiceKnowledgeTools(
  binding: KnowledgeBinding,
  business: VoiceKnowledgeDependencies["business"],
  schedule: ScheduleVoiceTask,
  { recordUnanswered = true, source = "phone" }: KnowledgeToolOptions = {},
) {
  const [{ adminDb }, { createQueryEmbedder }, { createVectorStore }, { knowledgeSettings }] = await Promise.all([
    import("@/lib/firebase/admin"), import("../../rag/embeddings"), import("../../rag/vector-store"), import("../../rag/settings"),
  ]);
  const settings = knowledgeSettings();
  const store = createVectorStore(adminDb);
  return knowledgeActions(binding, {
    enabled: () => settings.enabled,
    business,
    // Short timeout + cache: a stuck embedding request must not hold the caller for long.
    embed: createQueryEmbedder(settings),
    // Looks slightly past the cut-off so near misses are logged; maxDistance drops them.
    nearest: (businessId, vector) => store.nearest(businessId, vector, settings.topK, nearMissDistance(settings.maxDistance)),
    maxDistance: settings.maxDistance,
    keywordCandidates: (businessId, terms) => store.keywordCandidates(businessId, terms),
    unanswered: question => {
      if (!recordUnanswered) return;
      try {
        schedule("knowledge-unanswered", async () => {
          const { recordUnansweredQuestion } = await import("../../learning/unanswered");
          await recordUnansweredQuestion(binding.businessId, question);
        });
      } catch { /* Learning must never break a call. */ }
    },
    logSearch: entry => {
      schedule("knowledge-search-log", async () => {
        const { recordKnowledgeSearch } = await import("../../rag/search-log");
        await recordKnowledgeSearch(binding.businessId, {
          ...entry, source, settings: { model: settings.model, topK: settings.topK, maxDistance: settings.maxDistance },
        });
      });
    },
  });
}
