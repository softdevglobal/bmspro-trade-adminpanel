import "server-only";
import type { VoiceBusiness } from "../../config";

/**
 * Every voice tool checks the business is still active before answering, and a
 * call makes many tool requests. A short per-process cache saves a Firestore read
 * (about 0.3 s) on most of them, the same way the DID lookup is cached. Only
 * active businesses are cached, so a deactivation applies within the TTL at most.
 */
const BUSINESS_CACHE_TTL_MS = 10_000;
const businessCache = new Map<string, { data: FirebaseFirestore.DocumentData; expiresAt: number }>();
export function clearVoiceBusinessCache(businessId?: string) {
  if (businessId) businessCache.delete(businessId); else businessCache.clear();
}

export async function createTradeServiceTools(binding: VoiceBusiness) {
  const [{ adminDb }, { isTenantAccessAllowed }] = await Promise.all([
    import("@/lib/firebase/admin"), import("@/lib/onboarding/business-status"),
  ]);
  const business = async () => {
    const cached = businessCache.get(binding.businessId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = (await adminDb.collection("businesses").doc(binding.businessId).get()).data();
    if (!data || !isTenantAccessAllowed(data.status, data.isActive)) {
      businessCache.delete(binding.businessId);
      throw new Error("Business unavailable.");
    }
    if (businessCache.size > 1000) businessCache.clear();
    businessCache.set(binding.businessId, { data, expiresAt: Date.now() + BUSINESS_CACHE_TTL_MS });
    return data;
  };
  return {
    business,
    profile: async () => {
      const data = await business();
      return { brand: "trade", ...binding, businessName: data.businessName, address: data.businessAddress,
        phone: data.businessPhone, email: data.businessEmail, timezone: data.timezone || "Australia/Melbourne" };
    },
    services: async () => {
      // Both reads at once; if the business is inactive, business() throws and nothing is returned.
      const [, snapshot] = await Promise.all([
        business(),
        adminDb.collection("services").where("businessId", "==", binding.businessId).get(),
      ]);
      return snapshot.docs.filter(doc => doc.data().isActive === true).map(doc => {
        const data = doc.data();
        return { id: doc.id, name: data.name, businessType: data.businessType, defaultDurationMin: data.defaultDurationMin };
      });
    },
  };
}
