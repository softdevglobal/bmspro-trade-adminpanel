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
  }
  if (decoded.role === "pending_owner") throw new Error("Email verification required.");
  return decoded;
}
