/** MIME values and extensions are hints; only file bytes establish the format. */
export function imageType(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "image/gif";
  return null;
}

export function isPdf(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("ascii", 0, 5) === "%PDF-";
}

export function trustedStorageObject(raw: string, bucket: string, prefixes: string[]) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com" ||
      url.port || url.username || url.password || url.hash) throw new Error("Untrusted file host.");
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]) !== bucket) throw new Error("Untrusted Storage bucket.");
  const object = decodeURIComponent(match[2]);
  if (object.includes("\\") || object.split("/").some((part) => part === ".." || part === "." || !part) ||
      !prefixes.some((prefix) => object.startsWith(prefix))) throw new Error("File belongs to another tenant or category.");
  return object;
}
