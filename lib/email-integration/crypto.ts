import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for mailbox credentials. The key lives only in the
 * EMAIL_CREDENTIALS_KEY env var (32 bytes, base64), never in Firestore.
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */

const VERSION = "v1";

function readKey(): Buffer {
  const raw = process.env.EMAIL_CREDENTIALS_KEY?.trim();
  if (!raw) {
    throw new Error("EMAIL_CREDENTIALS_KEY is not configured.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("EMAIL_CREDENTIALS_KEY must be 32 bytes, base64-encoded.");
  }
  return key;
}

export function isCredentialKeyConfigured(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptJson<T>(sealed: string): T {
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported credential format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    readKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8")) as T;
}
