/**
 * Measures how well and how fast the knowledge search works, using real OpenAI
 * embeddings and the exact chunker / keyword / packaging code Sophie uses.
 *
 *   npm run eval:ai-knowledge
 *   npm run eval:ai-knowledge -- --set scripts/knowledge/eval/nira-electrical-lynbrook.eval.json
 *   npm run eval:ai-knowledge -- --model text-embedding-3-large --dimensions 1536
 *   npm run eval:ai-knowledge -- --out eval-report.json
 *
 * Firestore is NOT used: the vector search is done in memory with the same rule
 * Firestore applies (exact cosine distance, distance <= maxDistance, closest topK).
 * So accuracy numbers are exact, but Firestore's network time is not included;
 * read that from the live logs (`npm run ai-knowledge -- search-stats <businessId>`).
 *
 * Cost: one embedding call per question and one per chunk, a fraction of a cent.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chunkTableText, chunkText } from "../lib/ai/rag/chunker";
import { describePurpose } from "../lib/ai/data/knowledge-purpose";
import { createEmbedder, createQueryEmbedder, clearQueryEmbeddingCache } from "../lib/ai/rag/embeddings";
import { knowledgeSettings } from "../lib/ai/rag/settings";
import { keywordMatches, packagePassages, searchPassages } from "../lib/ai/rag/retriever";
import type { KnowledgePassage } from "../lib/ai/data/knowledge-chunks";
import type { KnowledgeKind } from "../lib/ai/data/knowledge-sources";

type EvalQuestion = { q: string; expect: string[]; contains?: string; acceptable?: string[] };
type EvalSet = {
  knowledge: string;
  catalogue?: { title: string; purpose: string; sheet: string; rows: string[] };
  questions: EvalQuestion[];
};
type Chunk = KnowledgePassage & { vector: number[] };

const args = process.argv.slice(2);
const flag = (name: string) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };

// ── helpers ──────────────────────────────────────────────────────────────────
const percentile = (values: number[], p: number) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at), high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);
const ms = (value: number) => `${value.toFixed(value < 10 ? 2 : 0)} ms`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const cosineDistance = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
};
const latencyRow = (label: string, values: number[]) =>
  ({ step: label, n: values.length, mean: ms(mean(values)), p50: ms(percentile(values, 0.5)), p90: ms(percentile(values, 0.9)), p95: ms(percentile(values, 0.95)), max: ms(Math.max(...values)) });

// ── 1. Build the same chunks the indexer would ──────────────────────────────
async function buildChunks(set: EvalSet, setDir: string): Promise<KnowledgePassage[]> {
  const entries = JSON.parse(await readFile(resolve(setDir, set.knowledge), "utf8")) as { kind: KnowledgeKind; title: string; body: string }[];
  const chunks: KnowledgePassage[] = [];
  for (const [index, entry] of entries.entries()) {
    // Typed entries have no "what is this file?" line, so the heading is the title.
    for (const chunk of chunkText(entry.title, entry.body)) {
      chunks.push({ sourceId: `entry-${index}`, sourceTitle: entry.title, kind: entry.kind, text: chunk.text, distance: 0 });
    }
  }
  if (set.catalogue) {
    const { title, purpose, sheet, rows } = set.catalogue;
    const heading = [title, describePurpose(purpose, "")].filter(Boolean).join("\n");
    for (const chunk of chunkTableText(heading, [`Sheet: ${sheet}`, ...rows].join("\n"))) {
      chunks.push({ sourceId: "catalogue", sourceTitle: title, kind: "document", text: chunk.text, distance: 0 });
    }
  }
  return chunks;
}

// ── 2. Score one configuration ───────────────────────────────────────────────
type QuestionOutcome = { q: string; answerable: boolean; correct: boolean; firstCorrect: boolean; rank: number | null; leaked: boolean; chars: number; returned: string[] };

function satisfies(question: EvalQuestion, passage: { title: string; text: string }) {
  return question.expect.includes(passage.title) && (!question.contains || passage.text.includes(question.contains));
}

async function runConfig(questions: EvalQuestion[], questionVectors: number[][], chunks: Chunk[], topK: number, maxDistance: number) {
  const outcomes: QuestionOutcome[] = [];
  for (const [index, question] of questions.entries()) {
    const vector = questionVectors[index];
    const { hits } = await searchPassages({
      embed: async () => [vector],
      // Firestore's rule: exact cosine distance, keep distance <= threshold, closest `limit`.
      nearest: async () => chunks
        .map(chunk => ({ ...chunk, distance: cosineDistance(vector, chunk.vector) }))
        .filter(chunk => chunk.distance <= maxDistance)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, topK)
        .map(chunk => ({ sourceId: chunk.sourceId, sourceTitle: chunk.sourceTitle, kind: chunk.kind, text: chunk.text, distance: chunk.distance })),
      keywordCandidates: async () => chunks,
    }, "eval", question.q);
    const result = packagePassages(hits);
    const answerable = question.expect.length > 0;
    const rankIndex = result.passages.findIndex(passage => satisfies(question, passage));
    const allowed = new Set([...question.expect, ...(question.acceptable ?? [])]);
    outcomes.push({
      q: question.q,
      answerable,
      correct: answerable ? rankIndex >= 0 : result.passages.every(passage => allowed.has(passage.title)),
      firstCorrect: answerable && rankIndex === 0,
      rank: rankIndex >= 0 ? rankIndex + 1 : null,
      leaked: !answerable && result.passages.some(passage => !allowed.has(passage.title)),
      chars: result.passages.reduce((sum, passage) => sum + passage.text.length, 0),
      returned: result.passages.map(passage => passage.title),
    });
  }
  const answerable = outcomes.filter(outcome => outcome.answerable);
  const unanswerable = outcomes.filter(outcome => !outcome.answerable);
  const recall = answerable.filter(o => o.correct).length / answerable.length;
  const noMatchAccuracy = unanswerable.length ? unanswerable.filter(o => o.correct).length / unanswerable.length : 1;
  return {
    topK, maxDistance,
    recall,                                                           // right passage was sent at all
    hitAt1: answerable.filter(o => o.firstCorrect).length / answerable.length, // right passage was first
    mrr: mean(answerable.map(o => (o.rank ? 1 / o.rank : 0))),
    noMatchAccuracy,                                                  // nothing wrong sent for unanswerable questions
    score: (recall + noMatchAccuracy) / 2,                            // balanced: missing an answer and sending a wrong one count the same
    avgChars: mean(outcomes.map(o => o.chars)),
    outcomes,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const setPath = resolve(flag("set") ?? "scripts/knowledge/eval/nira-electrical-lynbrook.eval.json");
  const set = JSON.parse(await readFile(setPath, "utf8")) as EvalSet;
  const base = knowledgeSettings();
  const settings = { ...base, model: flag("model") ?? base.model, dimensions: Number(flag("dimensions") ?? base.dimensions) };
  if (!settings.apiKey) throw new Error("OPENAI_API_KEY is not set (.env.local).");
  console.log(`\nKnowledge search evaluation — ${set.questions.length} questions, model ${settings.model} (${settings.dimensions} dims)`);
  console.log(`Current settings: topK=${base.topK}, maxDistance=${base.maxDistance}\n`);

  // Chunk + embed (indexing)
  const passages = await buildChunks(set, dirname(setPath));
  const indexStarted = performance.now();
  const chunkVectors = await createEmbedder(settings)(passages.map(p => p.text));
  const indexMs = performance.now() - indexStarted;
  const chunks: Chunk[] = passages.map((p, i) => ({ ...p, vector: chunkVectors[i] }));
  const sizes = passages.map(p => p.text.length);
  console.log(`Indexing: ${passages.length} chunks (avg ${Math.round(mean(sizes))} chars, max ${Math.max(...sizes)}), embedded in ${ms(indexMs)}\n`);

  // Question embeddings, one at a time like a live call, with the live timeout.
  const embedOne = createEmbedder(settings, fetch, { timeoutMs: 3_500, retries: 1, concurrency: 1 });
  const questionVectors: number[][] = [];
  const embedTimes: number[] = [];
  for (const question of set.questions) {
    const started = performance.now();
    questionVectors.push((await embedOne([question.q]))[0]);
    embedTimes.push(performance.now() - started);
  }
  // Cached question (asked again on the same server)
  clearQueryEmbeddingCache();
  const cachedEmbed = createQueryEmbedder(settings);
  const cachedTimes: number[] = [];
  for (const question of set.questions.slice(0, 5)) {
    await cachedEmbed([question.q]);
    const started = performance.now();
    await cachedEmbed([question.q]);
    cachedTimes.push(performance.now() - started);
  }
  // In-memory meaning search and keyword scoring on this data
  const searchTimes: number[] = [], keywordTimes: number[] = [];
  for (const vector of questionVectors) {
    const started = performance.now();
    chunks.map(c => cosineDistance(vector, c.vector)).sort((a, b) => a - b);
    searchTimes.push(performance.now() - started);
  }
  for (const question of set.questions) {
    const started = performance.now();
    keywordMatches(question.q, chunks);
    keywordTimes.push(performance.now() - started);
  }
  // Keyword scoring cost for bigger businesses (synthetic catalogue rows)
  const synthetic = (count: number): KnowledgePassage[] => Array.from({ length: count }, (_, i) => ({
    sourceId: "s", sourceTitle: "Catalogue", kind: "document", distance: 0,
    text: `Catalogue\nSheet: Stock\n${Array.from({ length: 4 }, (_, r) => `name: Item ${i}-${r} Model X${(i * 7 + r) % 997} | code: C${i}${r} | price: $${(i % 300) + r}.00`).join("\n")}`,
  }));
  const scaleRows = [1000, 8000].map(count => {
    const corpus = synthetic(count);
    const times = set.questions.slice(0, 20).map(question => { const s = performance.now(); keywordMatches(question.q, corpus); return performance.now() - s; });
    return latencyRow(`Keyword scoring, ${count.toLocaleString()} passages`, times);
  });

  console.log("LATENCY (this machine → OpenAI; Firestore not included)");
  console.table([
    latencyRow("Question embedding (OpenAI, uncached)", embedTimes),
    latencyRow("Question embedding (cached repeat)", cachedTimes),
    latencyRow(`Meaning search in memory (${chunks.length} chunks)`, searchTimes),
    latencyRow(`Keyword scoring (${chunks.length} chunks)`, keywordTimes),
    ...scaleRows,
  ]);

  // Distance distribution: how close is the right answer, and how close is the nearest wrong one?
  const correctDistances: number[] = [], unanswerableDistances: number[] = [];
  set.questions.forEach((question, index) => {
    const ranked = chunks.map(c => ({ c, d: cosineDistance(questionVectors[index], c.vector) })).sort((a, b) => a.d - b.d);
    if (question.expect.length) {
      const best = ranked.find(({ c }) => satisfies(question, { title: c.sourceTitle, text: c.text }));
      if (best) correctDistances.push(best.d);
    } else {
      const allowed = new Set(question.acceptable ?? []);
      const nearestWrong = ranked.find(({ c }) => !allowed.has(c.sourceTitle));
      if (nearestWrong) unanswerableDistances.push(nearestWrong.d);
    }
  });
  const dist = (label: string, values: number[]) => ({ distances: label, n: values.length, min: values.length ? Math.min(...values).toFixed(3) : "-",
    p10: percentile(values, 0.1).toFixed(3), p50: percentile(values, 0.5).toFixed(3), p90: percentile(values, 0.9).toFixed(3), max: values.length ? Math.max(...values).toFixed(3) : "-" });
  console.log("\nCOSINE DISTANCES (0 = same meaning)");
  console.table([dist("Right answer, answerable questions", correctDistances), dist("Nearest wrong passage, unanswerable questions", unanswerableDistances)]);

  // Sweep the two search settings
  const results = [];
  for (let topK = 1; topK <= 8; topK++) {
    for (let d = 0.30; d <= 0.801; d += 0.025) {
      results.push(await runConfig(set.questions, questionVectors, chunks, topK, Math.round(d * 1000) / 1000));
    }
  }
  const current = await runConfig(set.questions, questionVectors, chunks, base.topK, base.maxDistance);
  const ranked = [...results].sort((a, b) => b.score - a.score || b.hitAt1 - a.hitAt1 || b.mrr - a.mrr || a.avgChars - b.avgChars || a.topK - b.topK);
  const best = ranked[0];
  const view = (r: typeof best, label = "") => ({
    config: label, topK: r.topK, maxDistance: r.maxDistance, score: pct(r.score), recall: pct(r.recall),
    "hit@1": pct(r.hitAt1), mrr: r.mrr.toFixed(3), "noMatch ok": pct(r.noMatchAccuracy), "avg chars sent": Math.round(r.avgChars),
  });
  console.log("\nACCURACY — current settings vs best found");
  console.table([view(current, "current"), view(best, "best")]);
  console.log("Top 10 settings:");
  console.table(ranked.slice(0, 10).map(r => view(r)));
  console.log(`Effect of maxDistance at topK=${best.topK}:`);
  console.table(results.filter(r => r.topK === best.topK).map(r => view(r)));

  const misses = best.outcomes.filter(o => !o.correct);
  if (misses.length) {
    console.log(`\nQuestions still wrong with the best settings (${misses.length}):`);
    for (const miss of misses) console.log(`  ${miss.answerable ? "MISSED" : "LEAKED"}  "${miss.q}"  → ${miss.returned.length ? miss.returned.join(", ") : "NO_MATCH"}`);
  }
  const currentMisses = current.outcomes.filter(o => !o.correct);
  if (currentMisses.length) {
    console.log(`\nQuestions wrong with the current settings (${currentMisses.length}):`);
    for (const miss of currentMisses) console.log(`  ${miss.answerable ? "MISSED" : "LEAKED"}  "${miss.q}"  → ${miss.returned.length ? miss.returned.join(", ") : "NO_MATCH"}`);
  }

  const out = flag("out");
  if (out) {
    await writeFile(out, JSON.stringify({
      model: settings.model, dimensions: settings.dimensions, chunks: chunks.length, questions: set.questions.length,
      latency: { embedMs: embedTimes, cachedEmbedMs: cachedTimes, keywordMs: keywordTimes, indexMs },
      distances: { correct: correctDistances, unanswerableNearest: unanswerableDistances },
      current: { ...current, outcomes: current.outcomes }, best: { ...best, outcomes: best.outcomes },
      sweep: results.map(r => ({ topK: r.topK, maxDistance: r.maxDistance, score: r.score, recall: r.recall, hitAt1: r.hitAt1, mrr: r.mrr, noMatchAccuracy: r.noMatchAccuracy, avgChars: r.avgChars })),
    }, null, 2));
    console.log(`\nFull report written to ${out}`);
  }
}

main().then(() => process.exit(0), error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
