import "server-only";

import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

export function callbackState(businessId: string, callerKey: string) {
  const id = createHash("sha256").update(JSON.stringify([businessId, callerKey])).digest("hex");
  return adminDb.collection("missed_call_callback_states").doc(id);
}

export async function resolveCallback(businessId: string, callerKey: string, through: number) {
  const ref = callbackState(businessId, callerKey);
  await adminDb.runTransaction(async transaction => {
    const current = (await transaction.get(ref)).get("through") as number | undefined;
    if ((current ?? -1) < through) {
      transaction.set(ref, { through, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
}
