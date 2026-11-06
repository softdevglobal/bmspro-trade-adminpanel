/**
 * Pilot tool for Trade RAG before the owner dashboard exists.
 *
 *   npm run ai-knowledge -- seed   <businessId> <entries.json> [--publish]
 *   npm run ai-knowledge -- facts  <businessId>
 *   npm run ai-knowledge -- search <businessId> "Do you charge a call-out fee?"
 *
 * seed   : upserts owner FAQ/policy/note entries from a JSON file and indexes them.
 *          Entries are drafts unless --publish is passed. Flagged text is never auto-published.
 * facts  : builds draft "Business facts" and "Service descriptions" from settings.
 * search : runs the same retrieval Sophie uses (published entries only) and prints passages.
 *
 * Uses OPENAI_API_KEY and the AI_KNOWLEDGE_* settings from .env.local.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase/admin";
import { KNOWLEDGE_SOURCES_COLLECTION, knowledgeSourceCreate } from "../lib/ai/data/knowledge-sources";
import { scanKnowledgeText } from "../lib/ai/learning/redact";
import { indexKnowledgeSource, refreshGeneratedSources } from "../lib/ai/rag/ingest";
import { createEmbedder } from "../lib/ai/rag/embeddings";
import { createVectorStore } from "../lib/ai/rag/vector-store";
import { knowledgeSettings } from "../lib/ai/rag/settings";
import { retrievePassages } from "../lib/ai/rag/retriever";
import { z } from "zod";

const [command, businessId, arg, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error('Usage: seed <businessId> <entries.json> [--publish] | facts <businessId> | search <businessId> "<question>"');
  process.exit(1);
};

async function requireBusiness(id: string) {
  if (!id || id.includes("/")) usage();
  const doc = await adminDb.collection("businesses").doc(id).get();
  if (!doc.exists) throw new Error(`Business ${id} not found.`);
  console.log(`Business: ${doc.get("businessName") ?? id}`);
}

async function seed(file: string, publish: boolean) {
  const all = z.array(knowledgeSourceCreate).min(1).max(100).parse(JSON.parse(await readFile(file, "utf8")));
  // Entries still holding placeholder text are skipped (never saved), so a file can be filled in gradually.
  const entries = all.filter(entry => {
    if (!/REPLACE WITH/i.test(entry.body)) return true;
    console.log(`- ${entry.title} → skipped (still has REPLACE WITH text)`);
    return false;
  });
  for (const entry of entries) {
    const flags = scanKnowledgeText(`${entry.title}\n${entry.body}`);
    // Stable id per title, so re-running the script updates instead of duplicating.
    const id = `${businessId}__seed_${createHash("sha256").update(entry.title.toLowerCase()).digest("hex").slice(0, 16)}`;
    const ref = adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(id);
    const status = flags.length ? "needs_review" : publish ? "published" : "draft";
    await adminDb.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      tx.set(ref, {
        businessId, kind: entry.kind, title: entry.title, body: entry.body, generated: false,
        status, flags,
        version: Number(current?.version ?? 0) + 1,
        indexedVersion: Number(current?.indexedVersion ?? 0),
        chunkCount: Number(current?.chunkCount ?? 0),
        indexError: null, updatedBy: "seed-ai-knowledge",
        createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        publishedAt: status === "published" ? FieldValue.serverTimestamp() : current?.publishedAt ?? null,
      });
    });
    const ok = await indexKnowledgeSource(id);
    console.log(`${ok ? "✓" : "✗"} ${entry.title} → ${status}${flags.length ? ` (flags: ${flags.join(", ")} — review before publishing)` : ""}`);
  }
}

async function search(question: string) {
  const settings = knowledgeSettings();
  const store = createVectorStore(adminDb);
  const embed = createEmbedder(settings);
  const started = performance.now();
  const result = await retrievePassages({
    embed,
    nearest: async (id, vector) => {
      const hits = await store.nearest(id, vector, settings.topK, settings.maxDistance);
      for (const hit of hits) console.log(`  distance=${hit.distance.toFixed(3)}  ${hit.sourceTitle}`);
      return hits;
    },
  }, businessId, question);
  console.log(`Status: ${result.status}  (${Math.round(performance.now() - started)} ms, maxDistance=${settings.maxDistance})`);
  for (const passage of result.passages) console.log(`\n--- ${passage.title}\n${passage.text}`);
}

async function main() {
  await requireBusiness(businessId);
  if (command === "seed") { if (!arg) usage(); await seed(arg, rest.includes("--publish")); }
  else if (command === "facts") { await refreshGeneratedSources(businessId); console.log("Generated sources refreshed (drafts until published)."); }
  else if (command === "search") { if (!arg) usage(); await search([arg, ...rest].join(" ")); }
  else usage();
}

main().then(() => process.exit(0), error => {
  console.error(error instanceof Error ? error.message : "Failed.");
  process.exit(1);
});
