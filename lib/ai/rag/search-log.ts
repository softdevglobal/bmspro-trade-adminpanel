/**
 * Records how each knowledge search during a call went: how long each part took,
 * which entries came back and how close they were. Used to tune the search
 * settings with real calls (see scripts/eval-ai-knowledge.ts for the offline test).
 *
 * Stores the redacted question only, never transcripts or caller details.
 * Firestore's TTL policy on `expireAt` deletes each log after 30 days.
 */
import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { KNOWLEDGE_SEARCH_LOGS_COLLECTION } from "../data/knowledge-sources";
import { redactPersonalData } from "../learning/redact";
import type { SearchStats } from "./retriever";

const KEEP_DAYS = 30;

export type KnowledgeSearchLog = {
  question: string;
  status: "FOUND" | "NO_MATCH";
  passagesSent: number;
  stats: SearchStats;
  settings: { model: string; topK: number; maxDistance: number };
};

export async function recordKnowledgeSearch(businessId: string, entry: KnowledgeSearchLog) {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  await adminDb.collection(KNOWLEDGE_SEARCH_LOGS_COLLECTION).add({
    businessId,
    question: redactPersonalData(entry.question).slice(0, 300),
    status: entry.status,
    passagesSent: entry.passagesSent,
    hitCount: entry.stats.hits.length,
    hits: entry.stats.hits.slice(0, 10).map(hit => ({
      sourceId: hit.sourceId,
      sourceTitle: hit.sourceTitle.slice(0, 120),
      keyword: hit.keyword,
      distance: hit.distance === null ? null : round(hit.distance),
    })),
    // Closest passage by meaning, including one just past the cut-off (a near miss).
    closestDistance: entry.stats.closestDistance === null ? null : round(entry.stats.closestDistance),
    embedMs: entry.stats.embedMs,
    nearestMs: entry.stats.nearestMs,
    keywordMs: entry.stats.keywordMs,
    totalMs: entry.stats.totalMs,
    keywordCandidates: entry.stats.candidates,
    model: entry.settings.model,
    topK: entry.settings.topK,
    maxDistance: entry.settings.maxDistance,
    createdAt: FieldValue.serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + KEEP_DAYS * 86_400_000),
  });
}
