/**
 * Server-side image upload (`lib/onboarding/services/upload.ts`).
 *
 * Images go to Firebase Storage; only the imageUrl string is saved in Firestore.
 */

import "server-only";

import { getStorageBucketName } from "@/lib/firebase/admin";
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

/** Maximum allowed upload size (5 MB). */
const MAX_BYTES = 5 * 1024 * 1024;

/** MIME types accepted for service images. */
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Resolves a trusted image MIME type when clients send octet-stream or omit it. */
function resolveImageContentType(
  reportedType: string,
  filename: string,
  file: Buffer,
): string | null {
  const normalized = reportedType.trim().toLowerCase();
  if (ALLOWED_TYPES.has(normalized)) return normalized;

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext && EXT_TO_MIME[ext] && ALLOWED_TYPES.has(EXT_TO_MIME[ext])) {
    return EXT_TO_MIME[ext];
  }

  if (file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    file.length >= 8 &&
    file[0] === 0x89 &&
    file[1] === 0x50 &&
    file[2] === 0x4e &&
    file[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    file.length >= 12 &&
    file.subarray(0, 4).toString("ascii") === "RIFF" &&
    file.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  const header = file.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") {
    return "image/gif";
  }

  if (!normalized || normalized === "application/octet-stream") {
    return EXT_TO_MIME[ext] ?? "image/jpeg";
  }

  return null;
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
  },
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  if (!ALLOWED_TYPES.has(contentType)) {
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
  if (!ALLOWED_TYPES.has(contentType)) {
    return {
      ok: false,
      error: "Unsupported image type. Use JPEG, PNG, WebP, or GIF.",
    };
  }
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
 * Uploads a quotation attachment image to Firebase Storage.
 */
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
    console.error("uploadQuotationImage failed:", error);
    return { ok: false, error: "Could not upload image." };
  }
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
