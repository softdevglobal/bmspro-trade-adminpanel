import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { resolveAppBaseUrl } from "@/lib/config/base-url";

export function activationDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** The random account password is never sent to the customer or reused. */
export function inaccessibleInitialPassword() {
  return randomBytes(32).toString("base64url");
}

export async function issueActivationLink(uid: string, kind: "owner" | "customer" | "staff") {
  const base = resolveAppBaseUrl();
  if (!base) throw new Error("APP_URL is required for account activation emails.");
  const token = randomBytes(32).toString("base64url");
  const digest = activationDigest(token);
  const profile = adminDb.collection(kind === "customer" ? "customers" : "users").doc(uid);
  const batch = adminDb.batch();
  batch.set(adminDb.collection("account_activations").doc(digest), {
    uid, kind, expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
    consumed: false, createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(profile, { activationDigest: digest });
  await batch.commit();
  return `${base}/activate/${token}`;
}

/** Only call after proving mailbox ownership with an activation token or reset OTP. */
export async function completeAccountActivation(uid: string) {
  const [user, customer] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("customers").doc(uid).get(),
  ]);
  await adminAuth.updateUser(uid, { emailVerified: true });
  await adminAuth.revokeRefreshTokens(uid);
  const data = user.data();
  if (data?.role === "owner" && typeof data.businessId === "string") {
    const authUser = await adminAuth.getUser(uid);
    await adminAuth.setCustomUserClaims(uid, {
      ...authUser.customClaims, role: "owner", businessId: data.businessId,
    });
    const business = adminDb.collection("businesses").doc(data.businessId);
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(business);
      if (snap.data()?.emailVerificationPending === true) {
        tx.update(business, { emailVerificationPending: false, status: "active", isActive: true });
      }
    });
  }
  const batch = adminDb.batch();
  for (const snap of [user, customer]) {
    if (snap.exists) batch.update(snap.ref, {
      activationRequired: false, mustChangePassword: false, emailVerificationRequired: false,
      activationDigest: FieldValue.delete(), passwordChangedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function activateAccount(token: string, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 12 || password.length > 128) {
    throw new Error("Use a valid activation link and a password of 12–128 characters.");
  }
  const digest = activationDigest(token);
  const ref = adminDb.collection("account_activations").doc(digest);
  const activation = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.consumed || !(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) {
      throw new Error("This activation link has expired or has already been used. Reset your password to continue.");
    }
    const profile = await tx.get(adminDb.collection(data.kind === "customer" ? "customers" : "users").doc(data.uid));
    if (profile.data()?.activationDigest !== digest) throw new Error("This activation link has been replaced.");
    tx.update(ref, { consumed: true, consumedAt: FieldValue.serverTimestamp() });
    return { uid: data.uid as string, kind: data.kind as string, slug: profile.data()?.registeredBookingSlug as string | undefined };
  });
  // Consume before touching Auth: simultaneous submissions cannot change the password twice.
  // A failed Auth operation requires a fresh reset code; never reopen a consumed token.
  await adminAuth.updateUser(activation.uid, { password });
  await completeAccountActivation(activation.uid);
  return activation.kind === "customer" && activation.slug
    ? `/booknow/${encodeURIComponent(activation.slug)}/account` : "/login";
}
