import "server-only";

import { adminStorage, getStorageBucketName } from "@/lib/firebase/admin";
import { imageType, isPdf, trustedStorageObject } from "@/lib/security/file-types";

/** Reads a validated object through the SDK, so redirects and arbitrary URL egress are impossible. */
export async function readTrustedStorage(url: string, prefixes: string[], type: "pdf" | "image") {
  const bucket = getStorageBucketName();
  const object = trustedStorageObject(url, bucket, prefixes);
  const max = type === "pdf" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  const stream = adminStorage.bucket(bucket).file(object).createReadStream();
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = []; let size = 0;
    const timer = setTimeout(() => stream.destroy(new Error("File read timed out.")), 10_000);
    stream.on("data", (part: Buffer) => {
      size += part.length;
      if (size > max) stream.destroy(new Error("File exceeds the size limit."));
      else parts.push(part);
    });
    stream.on("error", (error) => { clearTimeout(timer); reject(error); });
    stream.on("end", () => { clearTimeout(timer); resolve(Buffer.concat(parts)); });
  });
  if (type === "pdf" ? !isPdf(bytes) : !imageType(bytes)) throw new Error("File content does not match its format.");
  return bytes;
}
