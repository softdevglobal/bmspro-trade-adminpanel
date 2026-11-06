import { z } from "zod";

export const KNOWLEDGE_SOURCES_COLLECTION = "ai_knowledge_sources";
export const KNOWLEDGE_CHUNKS_COLLECTION = "ai_knowledge_chunks";
export const UNANSWERED_COLLECTION = "ai_unanswered_questions";

export const OWNER_KINDS = ["faq", "policy", "note"] as const;
export const GENERATED_KINDS = ["business_facts", "service_descriptions"] as const;
export type KnowledgeKind = (typeof OWNER_KINDS)[number] | (typeof GENERATED_KINDS)[number];

export const KNOWLEDGE_STATUSES = ["draft", "needs_review", "published", "archived"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export type KnowledgeFlag = "personal_data" | "instruction_like";

export type KnowledgeSource = {
  id: string;
  businessId: string;
  kind: KnowledgeKind;
  generated: boolean;
  title: string;
  body: string;
  status: KnowledgeStatus;
  flags: KnowledgeFlag[];
  version: number;
  indexedVersion: number;
  chunkCount: number;
  indexError: string | null;
  updatedAt: number | null;
  publishedAt: number | null;
};

/** Owner creates a FAQ, policy or note. Business comes from the session, never the body. */
export const knowledgeSourceCreate = z.object({
  kind: z.enum(OWNER_KINDS),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(10).max(20_000),
}).strict();

/** Owner edits or changes status. `version` guards against overwriting a newer edit. */
export const knowledgeSourcePatch = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(2).max(120).optional(),
  body: z.string().trim().min(10).max(20_000).optional(),
  status: z.enum(["draft", "published"]).optional(),
  acknowledgeFlags: z.boolean().optional(),
}).strict();

export class KnowledgeError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Converts a Firestore document to the API shape. */
export function toKnowledgeSource(id: string, data: Record<string, unknown>): KnowledgeSource {
  const millis = (value: unknown) =>
    typeof (value as { toMillis?: () => number })?.toMillis === "function" ? (value as { toMillis: () => number }).toMillis() : null;
  return {
    id,
    businessId: String(data.businessId ?? ""),
    kind: data.kind as KnowledgeKind,
    generated: data.generated === true,
    title: String(data.title ?? ""),
    body: String(data.body ?? ""),
    status: (KNOWLEDGE_STATUSES as readonly string[]).includes(String(data.status)) ? data.status as KnowledgeStatus : "draft",
    flags: Array.isArray(data.flags) ? data.flags as KnowledgeFlag[] : [],
    version: Number(data.version ?? 1),
    indexedVersion: Number(data.indexedVersion ?? 0),
    chunkCount: Number(data.chunkCount ?? 0),
    indexError: typeof data.indexError === "string" ? data.indexError : null,
    updatedAt: millis(data.updatedAt),
    publishedAt: millis(data.publishedAt),
  };
}
