import { knowledgeQuestionArguments, type ScheduleVoiceTask } from "./action-schemas";
import { retrievePassages, type KnowledgeResult, type RetrieverDependencies } from "../../rag/retriever";
import type { VoiceBusiness } from "../../config";

export interface VoiceKnowledgeDependencies extends RetrieverDependencies {
  enabled(): boolean;
  business(): Promise<Record<string, unknown>>;
  unanswered(question: string): void;
}

/** Pure tool logic; dependencies are injected so tests need no Firestore or OpenAI. */
export function knowledgeActions(binding: VoiceBusiness, deps: VoiceKnowledgeDependencies) {
  return {
    search: async (raw: unknown): Promise<KnowledgeResult> => {
      if (!deps.enabled()) {
        return { status: "NO_MATCH", passages: [], message: "Business knowledge is not available. Do not guess." };
      }
      const parsed = knowledgeQuestionArguments.safeParse(raw);
      if (!parsed.success) {
        return { status: "REJECTED", passages: [], message: "Ask one short question about this business." };
      }
      // The business check runs alongside the search to save a round trip. If the
      // business became inactive it throws, Promise.all rejects and no passages
      // are returned (the tool reports UNAVAILABLE).
      const [, result] = await Promise.all([deps.business(), retrievePassages(deps, binding.businessId, parsed.data.question)]);
      if (result.status === "NO_MATCH") deps.unanswered(parsed.data.question);
      return result;
    },
  };
}

export async function createVoiceKnowledgeTools(
  binding: VoiceBusiness,
  business: VoiceKnowledgeDependencies["business"],
  schedule: ScheduleVoiceTask,
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
    nearest: (businessId, vector) => store.nearest(businessId, vector, settings.topK, settings.maxDistance),
    keywordCandidates: businessId => store.publishedPassages(businessId),
    unanswered: question => {
      try {
        schedule("knowledge-unanswered", async () => {
          const { recordUnansweredQuestion } = await import("../../learning/unanswered");
          await recordUnansweredQuestion(binding.businessId, question);
        });
      } catch { /* Learning must never break a call. */ }
    },
  });
}
