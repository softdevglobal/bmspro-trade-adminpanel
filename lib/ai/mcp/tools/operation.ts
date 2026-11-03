import { createHash } from "node:crypto";
import type { VoiceActionResult } from "./action-schemas";

export type VoiceOperationRecord = { fingerprint: string; result?: VoiceActionResult };
export interface VoiceOperationStore {
  claim(key: string, fingerprint: string): Promise<VoiceOperationRecord | null>;
  complete(key: string, result: VoiceActionResult): Promise<void>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const unknownVoiceOperation: VoiceActionResult = { status: "UNKNOWN", code: "RESULT_UNVERIFIED",
  message: "Staff must verify whether this action was saved. Do not claim success or submit it again with a new key." };

/** Durable claim before side effects; interrupted/uncertain writes are never sent twice. */
export async function runVoiceOperation(store: VoiceOperationStore, businessId: string, operation: string, requestKey: string,
  details: unknown, send: () => Promise<VoiceActionResult>): Promise<VoiceActionResult> {
  const key = hash(JSON.stringify([businessId, operation, requestKey]));
  const fingerprint = hash(canonical(details));
  const existing = await store.claim(key, fingerprint);
  if (existing) return existing.fingerprint === fingerprint ? existing.result ?? unknownVoiceOperation
    : { status: "REJECTED", code: "REQUEST_KEY_CONFLICT", message: "This key belongs to different details. Staff must check the original action; do not submit another." };
  let result: VoiceActionResult;
  try { result = await send(); } catch { result = unknownVoiceOperation; }
  try { await store.complete(key, result); } catch { return unknownVoiceOperation; }
  return result;
}

export async function voiceOperationStore(businessId: string, did: string, operation: string): Promise<VoiceOperationStore> {
  const { adminDb } = await import("@/lib/firebase/admin");
  const collection = adminDb.collection("ai_voice_submissions");
  return {
    claim: (key, fingerprint) => adminDb.runTransaction(async tx => {
      const ref = collection.doc(key), snapshot = await tx.get(ref);
      if (snapshot.exists) return snapshot.data() as VoiceOperationRecord;
      tx.create(ref, { fingerprint, businessId, did, operation, createdAt: new Date() });
      return null;
    }),
    complete: async (key, result) => { await collection.doc(key).update({ result, updatedAt: new Date() }); },
  };
}
