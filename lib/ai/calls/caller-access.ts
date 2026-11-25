import "server-only";
import { normalizeInvoiceCallbackNumber } from "./callback-number";

/** A phone match is recognition only. It never grants owner authorization. */
export function classifyPhoneCaller(caller: unknown, ownerPhone: unknown) {
  const normalize = (value: unknown) => typeof value === "string" && /^\+?[\d ()-]{6,40}$/.test(value)
    ? normalizeInvoiceCallbackNumber(value) : null;
  const actual = normalize(caller), expected = normalize(ownerPhone);
  return { role: actual && expected && actual === expected ? "owner_candidate" : "customer",
    ownerAccess: false, verificationRequired: true } as const;
}

export async function getPhoneCallerAccess(businessId: string, caller: string | null) {
  const { adminDb } = await import("@/lib/firebase/admin");
  const business = (await adminDb.collection("businesses").doc(businessId).get()).data();
  if (!business?.ownerUid) return classifyPhoneCaller(null, null);
  const [settings, owner] = await Promise.all([
    adminDb.collection("ai_owner_call_settings").doc(businessId).get(),
    adminDb.collection("users").doc(business.ownerUid).get(),
  ]);
  // Reception numbers are never an owner identity fallback. Only owner-managed
  // personal contact settings or the current owner's account phone are used.
  const saved = settings.data();
  const phone = saved && saved.ownerUid === business.ownerUid && saved.enabled ? saved.phone : owner.get("phone");
  return classifyPhoneCaller(caller, phone);
}
