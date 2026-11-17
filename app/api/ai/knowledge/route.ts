/**
 * Owner AI knowledge API. The business always comes from the signed-in owner's
 * token; no route accepts a business ID from the body or URL.
 *
 * GET  — list this business's knowledge entries (not archived).
 * POST — create a FAQ / policy / note. Saved as a draft (or needs_review when flagged).
 *        Talk to Sophie saves voice notes here too (createdVia: "owner_voice"), with a
 *        shorter length limit and a per-business hourly limit. They are never published here.
 */
import { after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KNOWLEDGE_SOURCES_COLLECTION, knowledgeSourceCreate, toKnowledgeSource } from "@/lib/ai/data/knowledge-sources";
import { scanKnowledgeText } from "@/lib/ai/learning/redact";
import { VOICE_DRAFT_BODY_MAX, VOICE_DRAFTS_PER_HOUR } from "@/lib/ai/owner-call/voice-draft";
import { consumeRateLimits } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const MAX_SOURCES_PER_BUSINESS = 200;
const LIST_PREVIEW_CHARS = 600;

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  try {
    const snapshot = await adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION)
      .where("businessId", "==", auth.businessId).orderBy("updatedAt", "desc").limit(MAX_SOURCES_PER_BUSINESS).get();
    // The list only needs a preview. Imported documents can be 300,000 characters each,
    // and the page re-fetches this list while entries are being prepared.
    const sources = snapshot.docs.map(doc => toKnowledgeSource(doc.id, doc.data()))
      .filter(source => source.status !== "archived")
      .map(source => ({ ...source, body: source.body.slice(0, LIST_PREVIEW_CHARS), bodyLength: source.body.length }));
    return json({ ok: true, sources, voiceEnabled: process.env.AI_VOICE_KNOWLEDGE_ENABLED === "true" });
  } catch {
    return json({ ok: false, error: "Could not load AI knowledge." }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  const parsed = knowledgeSourceCreate.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "Use a title of 2–120 characters and an answer of 10–20,000 characters." }, 400);
  const byVoice = parsed.data.createdVia === "owner_voice";
  if (byVoice && parsed.data.body.length > VOICE_DRAFT_BODY_MAX) {
    return json({ ok: false, error: "Voice notes can be up to 2,000 characters. Add longer content on the AI knowledge page." }, 400);
  }

  try {
    if (byVoice && !await consumeRateLimits([{ key: `ai-knowledge-voice:${auth.businessId}`, limit: VOICE_DRAFTS_PER_HOUR, windowMs: 3600_000 }])) {
      return json({ ok: false, error: "Too many voice notes this hour. Add more on the AI knowledge page." }, 429);
    }
    const collection = adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION);
    const count = await collection.where("businessId", "==", auth.businessId).count().get();
    if (count.data().count >= MAX_SOURCES_PER_BUSINESS) return json({ ok: false, error: "Knowledge entry limit reached." }, 400);

    const flags = scanKnowledgeText(`${parsed.data.title}\n${parsed.data.body}`);
    const ref = collection.doc();
    await ref.set({
      businessId: auth.businessId, ...parsed.data, generated: false,
      status: flags.length ? "needs_review" : "draft", flags,
      version: 1, indexedVersion: 0, chunkCount: 0, indexError: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid,
    });
    after(async () => {
      try { await (await import("@/lib/ai/rag/ingest")).indexKnowledgeSource(ref.id); }
      catch { console.error("[ai-knowledge] Indexing failed", { stage: "create" }); }
    });
    return json({ ok: true, id: ref.id, flags }, 201);
  } catch {
    return json({ ok: false, error: "Could not save the knowledge entry." }, 503);
  }
}
