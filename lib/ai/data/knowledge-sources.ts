import { z } from "zod";
import { KNOWLEDGE_PURPOSES, PURPOSE_NOTE_MAX, isKnowledgePurpose, type KnowledgePurpose } from "./knowledge-purpose";

export const KNOWLEDGE_SOURCES_COLLECTION = "ai_knowledge_sources";
export const KNOWLEDGE_CHUNKS_COLLECTION = "ai_knowledge_chunks";
export const UNANSWERED_COLLECTION = "ai_unanswered_questions";
/** One document per knowledge search during a call (server-only, deleted after 30 days). */
export const KNOWLEDGE_SEARCH_LOGS_COLLECTION = "ai_knowledge_search_logs";
/** One document per file upload link (server-only). See app/api/ai/knowledge/upload-url. */
export const KNOWLEDGE_UPLOADS_COLLECTION = "ai_knowledge_uploads";

export const OWNER_KINDS = ["faq", "policy", "note"] as const;
/** Entries read from a file or web page with LangChain loaders. */
export const IMPORTED_KINDS = ["document", "website"] as const;
export const GENERATED_KINDS = ["business_facts", "service_descriptions"] as const;
export type KnowledgeKind =
  | (typeof OWNER_KINDS)[number] | (typeof IMPORTED_KINDS)[number] | (typeof GENERATED_KINDS)[number];

export const isImportedKind = (kind: unknown): kind is (typeof IMPORTED_KINDS)[number] =>
  (IMPORTED_KINDS as readonly unknown[]).includes(kind);

export type ImportFileType = "pdf" | "pptx" | "docx" | "xlsx" | "csv" | "txt" | "md";
/** Where an imported entry's text came from. */
export type KnowledgeOrigin =
  | { type: ImportFileType; fileName: string; sizeBytes: number; parts: number }
  | { type: "url"; url: string };

export const OWNER_BODY_MAX = 20_000;      // typed entries
export const IMPORTED_BODY_MAX = 300_000;  // imported text (about 75 pages)
/** Firestore documents are limited to 1 MiB; keep the stored text well under it. */
export const IMPORTED_BODY_MAX_BYTES = 900_000;

/** Cuts long text at a line break (never mid-row or mid-word), within both limits. */
export function cutAtLine(text: string, maxChars = IMPORTED_BODY_MAX, maxBytes = IMPORTED_BODY_MAX_BYTES): string {
  let cut = text.slice(0, maxChars);
  while (new TextEncoder().encode(cut).length > maxBytes) cut = cut.slice(0, Math.floor(cut.length * 0.9));
  if (cut.length === text.length) return text;
  const line = cut.lastIndexOf("\n");
  return (line > cut.length * 0.5 ? cut.slice(0, line) : cut).trimEnd();
}

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
  /** Last time someone pressed Retry; used with updatedAt to spot stuck indexing. */
  indexRequestedAt: number | null;
  origin: KnowledgeOrigin | null;
  truncated: boolean;
  /** Imported entries: "What is this file?" and the owner's note. Null on older entries. */
  purpose: KnowledgePurpose | null;
  purposeNote: string;
  /** "owner_voice" when Sophie saved it from Talk to Sophie after the owner confirmed. */
  createdVia: "owner_voice" | null;
};

/** Owner creates a FAQ, policy or note. Business comes from the session, never the body. */
export const knowledgeSourceCreate = z.object({
  kind: z.enum(OWNER_KINDS),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(10).max(OWNER_BODY_MAX),
  /** Set by Talk to Sophie (lib/ai/owner-call/voice-draft-store.ts). Still saved as a draft. */
  createdVia: z.literal("owner_voice").optional(),
}).strict();

/** Owner edits or changes status. `version` guards against overwriting a newer edit. */
export const knowledgeSourcePatch = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(2).max(120).optional(),
  // Imported entries can be longer; the route enforces OWNER_BODY_MAX for typed ones.
  body: z.string().trim().min(10).max(IMPORTED_BODY_MAX).optional(),
  status: z.enum(["draft", "published"]).optional(),
  acknowledgeFlags: z.boolean().optional(),
  // Imported entries only (the route checks the kind).
  purpose: z.enum(KNOWLEDGE_PURPOSES).optional(),
  purposeNote: z.string().trim().max(PURPOSE_NOTE_MAX).optional(),
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
    indexRequestedAt: millis(data.indexRequestedAt),
    origin: data.origin && typeof data.origin === "object" ? data.origin as KnowledgeOrigin : null,
    truncated: data.truncated === true,
    purpose: isKnowledgePurpose(data.purpose) ? data.purpose : null,
    purposeNote: typeof data.purposeNote === "string" ? data.purposeNote : "",
    createdVia: data.createdVia === "owner_voice" ? "owner_voice" : null,
  };
}
