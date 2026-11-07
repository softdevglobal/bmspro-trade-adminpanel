import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";

/** Every tenant/customer API must use this verifier, including custom guards. */
export async function verifyAccountIdToken(token: string) {
  const decoded = await adminAuth.verifyIdToken(token, true);
  const [user, customer] = await Promise.all([
    adminDb.collection("users").doc(decoded.uid).get(),
    adminDb.collection("customers").doc(decoded.uid).get(),
  ]);
  for (const profile of [user.data(), customer.data()]) {
    if (profile?.activationRequired === true || profile?.mustChangePassword === true ||
        profile?.emailVerificationRequired === true) {
      throw new Error("Activate your account using the email link or reset your password to continue.");
    }
    if (profile?.disabled === true || profile?.suspended === true || profile?.isActive === false ||
        ["inactive", "disabled", "suspended"].includes(profile?.status)) {
      throw new Error("This account is unavailable.");
    }
  }
  if (decoded.role === "pending_owner") throw new Error("Email verification required.");

  const businessIds = new Set([
    decoded.businessId,
    user.data()?.businessId,
    customer.data()?.registeredBusinessId,
  ].filter((id): id is string => typeof id === "string" && id.length > 0));
  for (const businessId of businessIds) {
    const business = await adminDb.collection("businesses").doc(businessId).get();
    const data = business.data();
    if (!business.exists || data?.isActive === false || data?.status === "suspended") {
      throw new Error("This business is unavailable.");
    }
  }
  return decoded;
}
