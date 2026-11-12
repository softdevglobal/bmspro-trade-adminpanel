import type { KnowledgeKind } from "./knowledge-sources";

export type ChunkStatus = "draft" | "published";

export type KnowledgePassage = {
  sourceId: string;
  sourceTitle: string;
  kind: KnowledgeKind;
  text: string;
  distance: number;
};

export type ChunkToStore = { ordinal: number; text: string; embedding: number[] };
