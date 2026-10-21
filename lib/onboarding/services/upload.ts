import { imageType, isPdf } from "@/lib/security/file-types";
/**
 * Server-side image upload (`lib/onboarding/services/upload.ts`).
 *
 * Images go to Firebase Storage; only the imageUrl string is saved in Firestore.
 */

import "server-only";

import { getStorageBucketName } from "@/lib/firebase/admin";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

/** Maximum allowed image upload size (5 MB). */
const MAX_BYTES = 5 * 1024 * 1024;

/** Maximum allowed PDF upload size (10 MB). */
const PDF_MAX_BYTES = 10 * 1024 * 1024;

function resolveImageContentType(_reportedType: string, _filename: string, file: Buffer): string | null { return imageType(file); }
function resolvePdfContentType(_reportedType: string, _filename: string, file: Buffer): string | null { return isPdf(file) ? "application/pdf" : null; }

async function saveQuotationFileToStorage(
  file: Buffer,
  contentType: string,
  ext: string,
  options: {
    businessId: string;
    uid: string;
    inspectionRequestId?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const requestPart = options.inspectionRequestId?.trim() || "general";
  const path = `quotations/${options.businessId}/${requestPart}/${options.uid}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, imageUrl };
  } catch (error) {
    console.error("saveQuotationFileToStorage failed:", error);
    return { ok: false, error: "Could not upload file." };
  }
}

/**
 * Uploads a service or template image to Firebase Storage.
 *
 * @param file - Raw image bytes
 * @param contentType - MIME type of the image
 * @param options.scope - "service-templates" (super admin) or "services" (business owner)
 * @param options.uid - Uploader's Firebase Auth uid (used in storage path)
 * @param options.businessId - Required when scope is "services"
 * @returns Public HTTPS URL on success
 */
export async function uploadServiceImage(
  file: Buffer,
  contentType: string,
  options: {
    scope: "service-templates" | "services";
    uid: string;
    businessId?: string;
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const resolved = resolveImageContentType(
    contentType,
    options.filename ?? "",
    file,
  );
  if (!resolved) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }
  contentType = resolved;

  if (file.length > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);

  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const prefix =
    options.scope === "services" && options.businessId
      ? `services/${options.businessId}`
      : "service-templates";
  const path = `${prefix}/${options.uid}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

    return { ok: true, imageUrl };
  } catch (error) {
    console.error("uploadServiceImage failed:", error);
    return { ok: false, error: "Could not upload image." };
  }
}

/**
 * Uploads a business logo to Firebase Storage and returns a public URL.
 * `businessId` is used in the path for existing businesses; during public
 * onboarding (no account yet) logos go under a shared `onboarding` prefix.
 */
export async function uploadBusinessLogo(
  file: Buffer,
  contentType: string,
  options: { businessId?: string | null },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const detectedType = imageType(file);
  if (!detectedType || (contentType && contentType !== "application/octet-stream" && contentType !== detectedType)) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }
  contentType = detectedType;
  if (file.length > MAX_BYTES) {
    return { ok: false, error: "Logo must be 5 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const prefix = options.businessId
    ? `business-logos/${options.businessId}`
    : "business-logos/onboarding";
  const path = `${prefix}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, imageUrl };
  } catch (error) {
    console.error("uploadBusinessLogo failed:", error);
    return { ok: false, error: "Could not upload logo." };
  }
}

/**
 * Uploads a staff member profile photo to Firebase Storage and returns a public
 * URL. Owners upload photos for their team; the storage path is scoped by
 * business and (when known) the staff member's uid. New staff who do not have a
 * uid yet are stored under a `pending` prefix.
 */
export async function uploadStaffAvatar(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    staffId?: string | null;
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const resolved = resolveImageContentType(
    contentType,
    options.filename ?? "",
    file,
  );
  if (!resolved) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }

  if (file.length > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const ext = resolved.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const staffPart = options.staffId?.trim() || "pending";
  const path = `staff-avatars/${options.businessId}/${staffPart}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType: resolved,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, imageUrl };
  } catch (error) {
    console.error("uploadStaffAvatar failed:", error);
    return { ok: false, error: "Could not upload photo." };
  }
}

/**
 * Uploads a quotation attachment (image or PDF) to Firebase Storage.
 */
export async function uploadQuotationAttachment(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    uid: string;
    inspectionRequestId?: string;
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const filename = options.filename ?? "";

  const imageType = resolveImageContentType(contentType, filename, file);
  if (imageType) {
    if (file.length > MAX_BYTES) {
      return { ok: false, error: "Image must be 5 MB or smaller." };
    }
    const ext = imageType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    return saveQuotationFileToStorage(file, imageType, ext, options);
  }

  const pdfType = resolvePdfContentType(contentType, filename, file);
  if (pdfType) {
    if (file.length > PDF_MAX_BYTES) {
      return { ok: false, error: "PDF must be 10 MB or smaller." };
    }
    return saveQuotationFileToStorage(file, pdfType, "pdf", options);
  }

  return {
    ok: false,
    error: "Unsupported file type. Use JPEG, PNG, WebP, GIF, or PDF.",
  };
}

/**
 * Uploads a before/after job completion photo to Firebase Storage.
 */
export async function uploadJobCompletionImage(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    uid: string;
    bookingId: string;
    kind: "before" | "after";
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const resolved = resolveImageContentType(
    contentType,
    options.filename ?? "",
    file,
  );
  if (!resolved) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }

  if (file.length > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const ext = resolved.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const bookingPart = options.bookingId.trim() || "general";
  const path = `jobs/${options.businessId}/${bookingPart}/${options.kind}/${options.uid}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType: resolved,
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, imageUrl };
  } catch (error) {
    console.error("uploadJobCompletionImage failed:", error);
    return { ok: false, error: "Could not upload image." };
  }
}

/**
 * Uploads a customer photo attached to a booking portal request.
 */
export async function uploadBookingRequestImage(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    uid: string;
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const resolved = resolveImageContentType(
    contentType,
    options.filename ?? "",
    file,
  );
  if (!resolved) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }

  if (file.length > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const ext = resolved.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const path = `booking-requests/${options.businessId}/${options.uid}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType: resolved,
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, imageUrl };
  } catch (error) {
    console.error("uploadBookingRequestImage failed:", error);
    return { ok: false, error: "Could not upload image." };
  }
}

/** @deprecated Use uploadQuotationAttachment — kept for existing callers. */
export async function uploadQuotationImage(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    uid: string;
    inspectionRequestId?: string;
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  return uploadQuotationAttachment(file, contentType, options);
}

/**
 * Uploads a catalog item photo to Firebase Storage.
 */
export async function uploadItemImage(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    uid: string;
    filename?: string;
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const resolved = resolveImageContentType(
    contentType,
    options.filename ?? "",
    file,
  );
  if (!resolved) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }
  contentType = resolved;

  if (file.length > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const path = `items/${options.businessId}/${options.uid}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, imageUrl };
  } catch (error) {
    console.error("uploadItemImage failed:", error);
    return { ok: false, error: "Could not upload image." };
  }
}

function sanitizeDocumentName(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop()?.trim() || "document.pdf";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "_").replace(/^\.+/, "");
  const withExt = cleaned.toLowerCase().endsWith(".pdf")
    ? cleaned
    : `${cleaned || "document"}.pdf`;
  return withExt.slice(0, 200);
}

/**
 * Uploads a catalog item document (PDF) to Firebase Storage.
 */
export async function uploadItemDocument(
  file: Buffer,
  contentType: string,
  options: {
    businessId: string;
    uid: string;
    filename?: string;
  },
): Promise<
  | { ok: true; documentUrl: string; documentName: string }
  | { ok: false; error: string }
> {
  const filename = options.filename ?? "document.pdf";
  const resolved = resolvePdfContentType(contentType, filename, file);
  if (!resolved) {
    return { ok: false, error: "Unsupported file type. Use a PDF document." };
  }

  if (file.length > PDF_MAX_BYTES) {
    return { ok: false, error: "PDF must be 10 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const documentName = sanitizeDocumentName(filename);
  const bucket = getStorage().bucket(bucketName);
  const path = `items/${options.businessId}/${options.uid}/docs/${Date.now()}-${randomUUID()}-${documentName}`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType: resolved,
        metadata: {
          firebaseStorageDownloadTokens: token,
          originalName: documentName,
        },
      },
    });

    const documentUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, documentUrl, documentName };
  } catch (error) {
    console.error("uploadItemDocument failed:", error);
    return { ok: false, error: "Could not upload document." };
  }
}

/**
 * Uploads a generated quotation PDF to Firebase Storage and returns a public
 * download URL.
 */
export async function uploadQuotationPdf(
  file: Buffer,
  options: {
    businessId: string;
    inspectionRequestId: string;
    quotationId: string;
  },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const requestPart = options.inspectionRequestId.trim() || "general";
  const path = `quotations/${options.businessId}/${requestPart}/pdf/${options.quotationId}.pdf`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType: "application/pdf",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, url };
  } catch (error) {
    console.error("uploadQuotationPdf failed:", error);
    return { ok: false, error: "Could not upload PDF." };
  }
}

/**
 * Uploads a generated invoice PDF to Firebase Storage and returns a public
 * download URL.
 */
export async function uploadInvoicePdf(
  file: Buffer,
  options: {
    businessId: string;
    inspectionRequestId: string;
    invoiceId: string;
  },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const bucket = getStorage().bucket(bucketName);
  const requestPart = options.inspectionRequestId.trim() || "general";
  const path = `invoices/${options.businessId}/${requestPart}/pdf/${options.invoiceId}.pdf`;
  const token = randomUUID();

  try {
    await bucket.file(path).save(file, {
      metadata: {
        contentType: "application/pdf",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { ok: true, url };
  } catch (error) {
    console.error("uploadInvoicePdf failed:", error);
    return { ok: false, error: "Could not upload PDF." };
  }
}

const CAREPLUS_EVIDENCE_MAX_BYTES = 3 * 1024 * 1024;
const CAREPLUS_EVIDENCE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Uploads CarePlus evidence and returns a public URL plus file hash. */
export async function uploadCareplusEvidenceFile(
  file: Buffer,
  contentType: string,
  options: { businessId: string; filename?: string },
): Promise<
  | { ok: true; fileUrl: string; sha256: string; byteSize: number; filename: string }
  | { ok: false; error: string }
> {
  const { createHash } = await import("node:crypto");
  const type = contentType.trim().toLowerCase();
  if (!CAREPLUS_EVIDENCE_TYPES.has(type)) {
    return { ok: false, error: "Use a PDF, JPEG, PNG, or WebP file." };
  }
  if (file.length < 1 || file.length > CAREPLUS_EVIDENCE_MAX_BYTES) {
    return { ok: false, error: "Evidence files must be 3 MB or smaller." };
  }

  let bucketName: string;
  try {
    bucketName = getStorageBucketName();
  } catch {
    return { ok: false, error: "Storage bucket is not configured." };
  }

  const ext =
    type === "application/pdf"
      ? "pdf"
      : type.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  const filename =
    options.filename?.trim().replace(/[^\w.\-]+/g, "_").slice(0, 150) ||
    `evidence.${ext}`;
  const path = `careplus-evidence/${options.businessId}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();

  try {
    await getStorage().bucket(bucketName).file(path).save(file, {
      metadata: {
        contentType: type,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return {
      ok: true,
      fileUrl,
      sha256: createHash("sha256").update(file).digest("hex"),
      byteSize: file.length,
      filename,
    };
  } catch (error) {
    console.error("uploadCareplusEvidenceFile failed:", error);
    return { ok: false, error: "Could not upload evidence." };
  }
}
