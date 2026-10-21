import "server-only";
import { randomUUID } from "node:crypto";
import { adminStorage, getStorageBucketName } from "@/lib/firebase/admin";
import { trustedStorageObject } from "@/lib/security/file-types";
import { readTrustedStorage } from "@/lib/security/storage-read";

/** Promote a public onboarding upload to the permanent tenant logo namespace. */
export async function adoptOnboardingLogo(url: string | null | undefined, businessId: string) {
  if (!url) return null;
  const bucket = getStorageBucketName();
  const object = trustedStorageObject(url, bucket, ["business-logos/onboarding/", `business-logos/${businessId}/`]);
  if (object.startsWith(`business-logos/${businessId}/`)) return url;
  const bytes = await readTrustedStorage(url, ["business-logos/onboarding/"], "image");
  const contentType = object.endsWith(".png") ? "image/png" : object.endsWith(".gif") ? "image/gif" : object.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const target = `business-logos/${businessId}/${randomUUID()}.${object.split(".").at(-1)}`;
  const token = randomUUID();
  await adminStorage.bucket(bucket).file(target).save(bytes, { metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(target)}?alt=media&token=${token}`;
}
