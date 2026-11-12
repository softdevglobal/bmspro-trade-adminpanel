/**
 * POST { uploadId, title? } — reads a file the owner uploaded with a signed link,
 * turns it into text with LangChain loaders, and saves it as a draft knowledge entry.
 * The uploaded file is deleted afterwards; only the extracted text is kept.
 */
import { after } from "next/server";
import { z } from "zod";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KNOWLEDGE_UPLOADS_COLLECTION, KnowledgeError, type ImportFileType } from "@/lib/ai/data/knowledge-sources";
import { MAX_FILE_BYTES, extractFileText, hasExpectedSignature } from "@/lib/ai/rag/loaders/file-loaders";
import { allowImport, createImportedSource, indexInBackground } from "@/lib/ai/rag/import-source";
import { KNOWLEDGE_PURPOSES, PURPOSE_NOTE_MAX, purposeError } from "@/lib/ai/data/knowledge-purpose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // big PDFs can take a while to read

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const importRequest = z.object({
  uploadId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string().trim().min(2).max(120).optional(),
  purpose: z.enum(KNOWLEDGE_PURPOSES),
  purposeNote: z.string().trim().max(PURPOSE_NOTE_MAX).optional(),
}).strict();

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const parsed = importRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "Choose what this file is, then try again." }, 400);
  const invalidPurpose = purposeError(parsed.data.purpose, parsed.data.purposeNote ?? "");
  if (invalidPurpose) return json({ ok: false, error: invalidPurpose }, 400);

  try {
    if (!await allowImport(auth.businessId)) return json({ ok: false, error: "Too many imports. Try again in an hour." }, 429);
  } catch {
    return json({ ok: false, error: "Import is unavailable right now." }, 503);
  }

  const uploadRef = adminDb.collection(KNOWLEDGE_UPLOADS_COLLECTION).doc(parsed.data.uploadId);
  let upload: FirebaseFirestore.DocumentData;
  try {
    // Claim the upload once: same business, still pending, not expired. Stops double imports.
    upload = await adminDb.runTransaction(async tx => {
      const data = (await tx.get(uploadRef)).data();
      if (!data || data.businessId !== auth.businessId || data.status !== "pending") throw new KnowledgeError(404, "Upload not found.");
      if (data.expiresAt.toMillis() < Date.now()) throw new KnowledgeError(410, "The upload expired. Please try again.");
      tx.update(uploadRef, { status: "processing" });
      return data;
    });
  } catch (error) {
    return error instanceof KnowledgeError ? json({ ok: false, error: error.message }, error.status) : json({ ok: false, error: "Could not import." }, 503);
  }

  const file = adminStorage.bucket().file(String(upload.path));
  try {
    const [meta] = await file.getMetadata().catch(() => [null]);
    if (!meta) throw new KnowledgeError(400, "The file didn't finish uploading.");
    if (Number(meta.size) > MAX_FILE_BYTES) throw new KnowledgeError(400, "Files must be 25 MB or smaller.");
    const [buffer] = await file.download();
    const type = upload.fileType as ImportFileType;
    if (!hasExpectedSignature(type, buffer)) throw new KnowledgeError(400, "The file content doesn't match its type.");

    const { text, parts } = await extractFileText(type, buffer);
    const saved = await createImportedSource(auth, {
      kind: "document",
      title: parsed.data.title ?? String(upload.fileName).replace(/\.[^.]+$/, ""),
      text,
      origin: { type, fileName: String(upload.fileName), sizeBytes: buffer.length, parts },
      purpose: parsed.data.purpose, purposeNote: parsed.data.purposeNote,
    });
    await uploadRef.update({ status: "imported", sourceId: saved.id });
    after(() => indexInBackground(saved.id, "import"));
    return json({ ok: true, ...saved }, 201);
  } catch (error) {
    await uploadRef.update({ status: "failed" }).catch(() => {});
    return error instanceof KnowledgeError
      ? json({ ok: false, error: error.message }, error.status)
      : json({ ok: false, error: "Could not read this file. Is it damaged or password-protected?" }, 422);
  } finally {
    // We keep only the extracted text. The bucket lifecycle rule is the backup.
    await file.delete({ ignoreNotFound: true }).catch(() => {});
  }
}
