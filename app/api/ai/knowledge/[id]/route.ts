/**
 * One owner knowledge entry.
 *
 * GET    — read it.
 * PATCH  — edit title/body and/or publish/unpublish. `version` prevents overwriting a newer edit.
 * DELETE — archive it and remove its passages so Sophie stops using it.
 */
import { after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KNOWLEDGE_SOURCES_COLLECTION, KnowledgeError, knowledgeSourcePatch, toKnowledgeSource,
  type KnowledgeFlag, type KnowledgeStatus } from "@/lib/ai/data/knowledge-sources";
import { scanKnowledgeText } from "@/lib/ai/learning/redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const sourceRef = (id: string) => adminDb.collection(KNOWLEDGE_SOURCES_COLLECTION).doc(id);
const validId = (id: string) => /^[A-Za-z0-9_-]{1,160}$/.test(id);
const notFound = () => json({ ok: false, error: "Knowledge entry not found." }, 404);

export async function GET(request: Request, context: Context) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!validId(id)) return notFound();
  try {
    const data = (await sourceRef(id).get()).data();
    if (!data || data.businessId !== auth.businessId || data.status === "archived") return notFound();
    return json({ ok: true, source: toKnowledgeSource(id, data) });
  } catch {
    return json({ ok: false, error: "Could not load the knowledge entry." }, 503);
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!validId(id)) return notFound();
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid request body." }, 400); }
  const parsed = knowledgeSourcePatch.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: "Use a title of 2–120 characters and an answer of 10–20,000 characters." }, 400);
  const input = parsed.data;

  try {
    const outcome = await adminDb.runTransaction(async tx => {
      const ref = sourceRef(id);
      const data = (await tx.get(ref)).data();
      if (!data || data.businessId !== auth.businessId || data.status === "archived") throw new KnowledgeError(404, "Knowledge entry not found.");
      if (Number(data.version) !== input.version) throw new KnowledgeError(409, "This entry changed. Refresh and try again.");

      const title = input.title ?? String(data.title);
      const text = input.body ?? String(data.body);
      const textChanged = title !== data.title || text !== data.body;
      if (textChanged && data.generated === true) throw new KnowledgeError(400, "This entry updates from your business settings and services.");

      const flags: KnowledgeFlag[] = textChanged ? scanKnowledgeText(`${title}\n${text}`) : (data.flags ?? []);
      let status = data.status as KnowledgeStatus;
      if (textChanged) status = flags.length ? "needs_review" : status === "needs_review" ? "draft" : status;
      if (input.status === "draft") status = "draft";
      if (input.status === "published") {
        if (flags.length && input.acknowledgeFlags !== true) throw new KnowledgeError(400, "Review the flagged content and confirm before publishing.");
        status = "published";
      }

      const version = Number(data.version) + (textChanged ? 1 : 0);
      tx.update(ref, {
        title, body: text, flags, status, version,
        updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid,
        ...(status === "published" && data.status !== "published" ? { publishedAt: FieldValue.serverTimestamp(), publishedBy: auth.uid } : {}),
      });
      return { textChanged, statusChanged: status !== data.status, status, version };
    });

    after(async () => {
      try {
        if (outcome.textChanged) {
          // Re-embeds; the old passages stay searchable until the new ones are stored.
          await (await import("@/lib/ai/rag/ingest")).indexKnowledgeSource(id);
        } else if (outcome.statusChanged) {
          // Publish/unpublish only flips the passage status: no re-embedding cost.
          const { createVectorStore } = await import("@/lib/ai/rag/vector-store");
          await createVectorStore(adminDb).setSourceStatus(id, outcome.status === "published" ? "published" : "draft");
        }
      } catch { console.error("[ai-knowledge] Update indexing failed"); }
    });
    return json({ ok: true, status: outcome.status, version: outcome.version });
  } catch (error) {
    return error instanceof KnowledgeError
      ? json({ ok: false, error: error.message }, error.status)
      : json({ ok: false, error: "Could not save the knowledge entry." }, 503);
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { id } = await context.params;
  if (!validId(id)) return notFound();
  try {
    const ref = sourceRef(id);
    const data = (await ref.get()).data();
    if (!data || data.businessId !== auth.businessId) return notFound();
    await ref.update({ status: "archived", updatedAt: FieldValue.serverTimestamp(), updatedBy: auth.uid });
    after(async () => {
      try {
        const { createVectorStore } = await import("@/lib/ai/rag/vector-store");
        await createVectorStore(adminDb).deleteSource(id);
      } catch { console.error("[ai-knowledge] Chunk removal failed"); }
    });
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Could not delete the knowledge entry." }, 503);
  }
}
