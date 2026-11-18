import "server-only";

import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import { phoneComparisonKey } from "@/lib/users/phone-uniqueness";

const COLLECTION = "ai_customer_call_preferences";

function preferenceId(businessId: string, phoneKey: string) {
  return createHash("sha256").update(JSON.stringify([businessId, phoneKey])).digest("hex");
}

export async function isCustomerCallOptedOut(businessId: string, phone: string): Promise<boolean> {
  const phoneKey = phoneComparisonKey(phone);
  if (!phoneKey) return true;
  const snapshot = await adminDb.collection(COLLECTION).doc(preferenceId(businessId, phoneKey)).get();
  return snapshot.get("doNotCall") === true;
}

export async function setCustomerCallOptOut(input: {
  businessId: string; phone: string; doNotCall: boolean; source: "owner" | "customer_request"; actorUid?: string;
}) {
  const phoneKey = phoneComparisonKey(input.phone);
  if (!phoneKey) throw new Error("A valid customer phone number is required.");
  const ref = adminDb.collection(COLLECTION).doc(preferenceId(input.businessId, phoneKey));
  await ref.set({ businessId: input.businessId, phoneKey, doNotCall: input.doNotCall,
    source: input.source, ...(input.actorUid ? { updatedBy: input.actorUid } : {}), updatedAt: Date.now() }, { merge: true });
  return { phoneKey, doNotCall: input.doNotCall };
}

export async function lookupCustomerCallOptOuts(businessId: string, phones: string[]) {
  const unique = [...new Set(phones.map(phoneComparisonKey).filter((key): key is string => Boolean(key)))].slice(0, 100);
  const refs = unique.map(phoneKey => adminDb.collection(COLLECTION).doc(preferenceId(businessId, phoneKey)));
  const snapshots = refs.length ? await adminDb.getAll(...refs) : [];
  return Object.fromEntries(snapshots.map((snapshot, index) => [unique[index] ?? "", snapshot.get("doNotCall") === true]));
}
