import { createHmac, timingSafeEqual } from "node:crypto";

/** A public customer cannot opt into staff allocation or impersonate Sophie. */
export function verifyAiAssignmentSignature(body: unknown, timestamp: string | null, signature: string | null, secret = process.env.AI_STAFF_ASSIGNMENT_SECRET, now = Date.now()): boolean {
  if (!secret || secret.length < 32 || !timestamp || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000 || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${JSON.stringify(body)}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
