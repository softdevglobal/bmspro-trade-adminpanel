import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type Stripe from "stripe";

import { adminDb } from "@/lib/firebase/admin";
import { purchaseSmsPackageForBusiness, getSmsPackageById } from "@/lib/sms-packages/server";
import { getSubscriptionPlanById } from "@/lib/subscription-plans/server";
import {
  activateTenantSubscription,
} from "@/lib/stripe/billing";
import { resolveBusinessOwnerInfo } from "@/lib/catalog/tenant-package-usage";
import { getStripe } from "@/lib/stripe/client";

const FULFILLED_SESSIONS = "stripe_fulfilled_sessions";

function metadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isCheckoutSessionComplete(session: Stripe.Checkout.Session): boolean {
  if (session.status !== "complete") return false;
  return (
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required"
  );
}

async function markSessionFulfilled(
  sessionId: string,
  session: Stripe.Checkout.Session,
  type: string,
): Promise<void> {
  const businessId =
    metadataValue(session.metadata, "businessId") ||
    (typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : "");

  const planId = metadataValue(session.metadata, "planId");
  const smsPackageId = metadataValue(session.metadata, "smsPackageId");

  let businessName: string | null = null;
  let ownerName: string | null = null;
  let ownerEmail: string | null = null;
  let planName: string | null = null;
  let planPriceLabel: string | null = null;
  let smsPackageName: string | null = null;

  if (businessId) {
    const resolved = await resolveBusinessOwnerInfo(businessId);
    businessName = resolved.businessName;
    ownerName = resolved.ownerName;
    ownerEmail = resolved.ownerEmail;
  }

  if (planId) {
    const plan = await getSubscriptionPlanById(planId);
    planName = plan?.name ?? null;
    planPriceLabel = plan?.priceLabel ?? null;
  }

  if (smsPackageId) {
    const pkg = await getSmsPackageById(smsPackageId);
    smsPackageName = pkg?.name ?? null;
  }

  await adminDb.collection(FULFILLED_SESSIONS).doc(sessionId).set({
    sessionId,
    businessId,
    businessName,
    ownerName,
    ownerEmail,
    type,
    planId,
    planName,
    planPriceLabel,
    smsPackageId,
    smsPackageName,
    fulfilledAt: FieldValue.serverTimestamp(),
  });
}

async function isSessionFulfilled(sessionId: string): Promise<boolean> {
  const snap = await adminDb
    .collection(FULFILLED_SESSIONS)
    .doc(sessionId)
    .get();
  if (!snap.exists) return false;
  const data = snap.data() ?? {};
  return data.fulfilledAt != null;
}

/** Atomically reserves a checkout session so fulfillment runs at most once. */
async function claimCheckoutSessionForFulfillment(input: {
  sessionId: string;
  businessId: string;
  type: "sms_topup" | "subscription";
}): Promise<boolean> {
  const ref = adminDb.collection(FULFILLED_SESSIONS).doc(input.sessionId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.create(ref, {
      sessionId: input.sessionId,
      businessId: input.businessId,
      type: input.type,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<"sms_topup" | "subscription" | "skipped"> {
  const type = metadataValue(session.metadata, "type");
  const businessId =
    metadataValue(session.metadata, "businessId") ||
    (typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : null);

  if (!businessId) {
    console.warn("[stripe] checkout session missing businessId");
    return "skipped";
  }

  if (type === "sms_topup") {
    const smsPackageId = metadataValue(session.metadata, "smsPackageId");
    if (!smsPackageId) {
      throw new Error("SMS checkout missing smsPackageId metadata.");
    }
    await purchaseSmsPackageForBusiness(businessId, smsPackageId);
    return "sms_topup";
  }

  if (type === "subscription" && session.mode === "subscription") {
    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;

    if (!subscriptionId || !customerId) {
      throw new Error(
        "Subscription checkout missing customer or subscription id.",
      );
    }

    await activateTenantSubscription({
      businessId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      planId: metadataValue(session.metadata, "planId"),
    });
    return "subscription";
  }

  return "skipped";
}

function resolveCheckoutSessionType(
  session: Stripe.Checkout.Session,
): "sms_topup" | "subscription" | "skipped" {
  const type = metadataValue(session.metadata, "type");
  if (type === "sms_topup") return "sms_topup";
  if (type === "subscription" && session.mode === "subscription") {
    return "subscription";
  }
  return "skipped";
}

/** Confirms a completed Checkout session and applies credits / billing once. */
export async function confirmCheckoutSessionForBusiness(
  sessionId: string,
  businessId: string,
): Promise<{
  alreadyFulfilled: boolean;
  type: "sms_topup" | "subscription" | "skipped";
}> {
  const trimmedId = sessionId.trim();
  if (!trimmedId) {
    throw new Error("sessionId is required.");
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(trimmedId);

  const sessionBusinessId =
    metadataValue(session.metadata, "businessId") ||
    (typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : null);

  if (!sessionBusinessId || sessionBusinessId !== businessId) {
    throw new Error("This checkout session does not belong to your business.");
  }

  if (!isCheckoutSessionComplete(session)) {
    throw new Error("Payment is not complete yet. Please wait and refresh.");
  }

  const type = resolveCheckoutSessionType(session);
  if (type === "skipped") {
    return { alreadyFulfilled: false, type };
  }

  if (await isSessionFulfilled(trimmedId)) {
    return { alreadyFulfilled: true, type };
  }

  const claimed = await claimCheckoutSessionForFulfillment({
    sessionId: trimmedId,
    businessId: sessionBusinessId,
    type,
  });

  if (!claimed) {
    return { alreadyFulfilled: true, type };
  }

  const claimRef = adminDb.collection(FULFILLED_SESSIONS).doc(trimmedId);

  try {
    const fulfilledType = await fulfillCheckoutSession(session);
    if (fulfilledType !== "skipped") {
      await markSessionFulfilled(trimmedId, session, fulfilledType);
    }
    return { alreadyFulfilled: false, type: fulfilledType };
  } catch (error) {
    try {
      await claimRef.delete();
    } catch {
      // Ignore cleanup errors — a completed mark may have raced.
    }
    throw error;
  }
}
