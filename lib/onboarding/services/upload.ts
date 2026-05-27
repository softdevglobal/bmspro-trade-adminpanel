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
