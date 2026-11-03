import "server-only";
import type { VoiceBusiness } from "../../config";

export async function createTradeServiceTools(binding: VoiceBusiness) {
  const [{ adminDb }, { isTenantAccessAllowed }] = await Promise.all([
    import("@/lib/firebase/admin"), import("@/lib/onboarding/business-status"),
  ]);
  const business = async () => {
    const data = (await adminDb.collection("businesses").doc(binding.businessId).get()).data();
    if (!data || !isTenantAccessAllowed(data.status, data.isActive)) throw new Error("Business unavailable.");
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
      await business();
      const snapshot = await adminDb.collection("services").where("businessId", "==", binding.businessId).get();
      return snapshot.docs.filter(doc => doc.data().isActive === true).map(doc => {
        const data = doc.data();
        return { id: doc.id, name: data.name, businessType: data.businessType, defaultDurationMin: data.defaultDurationMin };
      });
    },
  };
}
