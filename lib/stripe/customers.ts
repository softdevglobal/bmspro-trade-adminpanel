import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { getStripe } from "@/lib/stripe/client";

type BusinessStripeProfile = {
  businessId: string;
  businessName: string;
  ownerEmail: string | null;
  stripeCustomerId: string | null;
};

async function loadBusinessStripeProfile(
  businessId: string,
): Promise<BusinessStripeProfile | null> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid : null;
  let ownerEmail: string | null = null;

  if (ownerUid) {
    const userSnap = await adminDb.collection("users").doc(ownerUid).get();
    const userData = userSnap.data() ?? {};
    ownerEmail =
      typeof userData.email === "string" ? userData.email.trim() : null;
  }

  return {
    businessId,
    businessName:
      typeof data.businessName === "string" && data.businessName.trim()
        ? data.businessName.trim()
        : "Business",
    ownerEmail,
    stripeCustomerId:
      typeof data.stripeCustomerId === "string" && data.stripeCustomerId.trim()
        ? data.stripeCustomerId.trim()
        : null,
  };
}

/** Returns an existing Stripe customer id or creates one and stores it on the business. */
export async function getOrCreateStripeCustomerId(
  businessId: string,
  email?: string | null,
): Promise<string> {
  const profile = await loadBusinessStripeProfile(businessId);
  if (!profile) {
    throw new Error("Business not found.");
  }
  if (profile.stripeCustomerId) {
    return profile.stripeCustomerId;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email?.trim() || profile.ownerEmail || undefined,
    name: profile.businessName,
    metadata: {
      businessId: profile.businessId,
    },
  });

  await adminDb.collection("businesses").doc(businessId).update({
    stripeCustomerId: customer.id,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return customer.id;
}

export async function findBusinessIdByStripeSubscriptionId(
  subscriptionId: string,
): Promise<string | null> {
  const snapshot = await adminDb
    .collection("businesses")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return snapshot.docs[0]?.id ?? null;
}
