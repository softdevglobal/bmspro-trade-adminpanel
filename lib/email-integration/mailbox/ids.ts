import { createHash } from "node:crypto";

/**
 * Firestore id for a stored message. Gmail ids are plain hex and used as is;
 * ids with characters Firestore can't take in a key (Outlook ids contain "/",
 * "+" and "=") are hashed. Lookups always go through this function.
 */
export function messageDocId(connectionId: string, providerMessageId: string): string {
  if (/^[A-Za-z0-9_-]{1,200}$/.test(providerMessageId)) {
    return `${connectionId}_${providerMessageId}`;
  }
  const hash = createHash("sha256").update(providerMessageId).digest("hex").slice(0, 40);
  return `${connectionId}_h${hash}`;
}
