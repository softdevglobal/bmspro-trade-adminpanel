/**
 * POST { fileName, sizeBytes } — gives the owner a 10-minute signed link to upload
 * ONE file to ONE exact Storage path. The browser uploads straight to Storage, so
 * big files never pass through Vercel (4.5 MB request limit), and storage.rules
 * stay fully locked: the signed link itself is the permission.
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { KNOWLEDGE_UPLOADS_COLLECTION } from "@/lib/ai/data/knowledge-sources";
import { FILE_MIME, MAX_FILE_BYTES, fileTypeFromName } from "@/lib/ai/rag/loaders/file-loaders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const uploadRequest = z.object({
  fileName: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
}).strict();

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const parsed = uploadRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "Files must be 25 MB or smaller." }, 400);
  const fileType = fileTypeFromName(parsed.data.fileName);
  if (!fileType) return json({ ok: false, error: "Use a PDF, PowerPoint (.pptx), Word (.docx), Excel (.xlsx), CSV, TXT or MD file." }, 400);

  const uploadRef = adminDb.collection(KNOWLEDGE_UPLOADS_COLLECTION).doc();
  const path = `ai-imports/${auth.businessId}/${uploadRef.id}`; // never use the user's file name in the path
  const headers = { "Content-Type": FILE_MIME[fileType], "x-goog-content-length-range": `1,${MAX_FILE_BYTES}` };
  try {
    const [uploadUrl] = await adminStorage.bucket().file(path).getSignedUrl({
      version: "v4", action: "write", expires: Date.now() + 10 * 60_000,
      contentType: headers["Content-Type"],
      extensionHeaders: { "x-goog-content-length-range": headers["x-goog-content-length-range"] },
    });
    await uploadRef.set({
      businessId: auth.businessId, uid: auth.uid, path, fileName: parsed.data.fileName, fileType,
      sizeBytes: parsed.data.sizeBytes, status: "pending", sourceId: null,
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000), createdAt: FieldValue.serverTimestamp(),
    });
    return json({ ok: true, uploadId: uploadRef.id, uploadUrl, headers });
  } catch {
    return json({ ok: false, error: "Could not start the upload." }, 503);
  }
}
