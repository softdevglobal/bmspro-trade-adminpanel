import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import {
  renewTenantSubscription,
} from "@/lib/subscription-plans/server";
import { applyPlanChangeToTenant } from "@/lib/subscription-plans/tenant-subscription";
import { isTrialCalendarActive } from "@/lib/subscription-plans/access";

function resolveStoredPlanId(data: Record<string, unknown>): string | null {
  if (typeof data.planId === "string" && data.planId.trim()) {
    return data.planId.trim();
  }
  const embedded = data.plan as { id?: string } | null | undefined;
  if (embedded && typeof embedded.id === "string" && embedded.id.trim()) {
    return embedded.id.trim();
  }
  return null;
}

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

/** Activates a tenant after subscription Checkout (first payment or post-trial renew). */
export async function activateTenantSubscription(input: {
  businessId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  planId?: string | null;
}): Promise<void> {
  const ref = adminDb.collection("businesses").doc(input.businessId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Business not found.");
  }

  const data = snap.data() ?? {};
  const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid : null;
  const storedPlanId = resolveStoredPlanId(data);
  const targetPlanId = input.planId?.trim() || storedPlanId;
  const samePlan = Boolean(targetPlanId && targetPlanId === storedPlanId);
  const trialEnd = toMillis(data.trial_end);

  if (isTrialCalendarActive({ trialEnd })) {
    throw new Error(
      "Payment is only required after your free trial ends. You still have trial access.",
    );
  }

  if (targetPlanId && !samePlan) {
    await applyPlanChangeToTenant(input.businessId, targetPlanId);
  } else {
    await renewTenantSubscription(input.businessId);
  }

  await ref.update({
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    billing_status: "active",
    accountStatus: "active",
    status: "active",
    isActive: true,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (ownerUid) {
    await adminDb.collection("users").doc(ownerUid).update({
      billing_status: "active",
      accountStatus: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/** Marks subscription billing as canceled (Stripe subscription ended). */
export async function markTenantSubscriptionCanceled(
  businessId: string,
): Promise<void> {
  const ref = adminDb.collection("businesses").doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data() ?? {};
  const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid : null;

  await ref.update({
    billing_status: "canceled",
    accountStatus: "canceled",
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (ownerUid) {
    await adminDb.collection("users").doc(ownerUid).update({
      billing_status: "canceled",
      accountStatus: "canceled",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

/** Handles a paid renewal invoice from Stripe. */
export async function handleSubscriptionInvoicePaid(
  businessId: string,
): Promise<void> {
  await renewTenantSubscription(businessId);
}
