import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import {
  buildTenantSmsRenewalFields,
  resolveSmsPackageForPlan,
} from "@/lib/sms-packages/server";
import {
  getSubscriptionPlanById,
  renewTenantSubscription,
} from "@/lib/subscription-plans/server";
import { applyPlanChangeToTenant } from "@/lib/subscription-plans/tenant-subscription";

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

/** Activates a tenant after the first successful subscription Checkout payment. */
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
  const isTrialing =
    data.billing_status === "trialing" || data.accountStatus === "active_trial";
  const samePlan = Boolean(targetPlanId && targetPlanId === storedPlanId);

  if (targetPlanId && !samePlan) {
    await applyPlanChangeToTenant(input.businessId, targetPlanId);
  } else if (targetPlanId && samePlan && !isTrialing) {
    const plan = await getSubscriptionPlanById(targetPlanId);
    if (plan) {
      const now = Date.now();
      const periodMs = plan.validityDays * 24 * 60 * 60 * 1000;
      const smsPackage = await resolveSmsPackageForPlan(plan);
      const smsFields = smsPackage
        ? buildTenantSmsRenewalFields(smsPackage, data, {
            periodEndMs: now + periodMs,
          })
        : {};
      if (Object.keys(smsFields).length > 0) {
        await ref.update({
          ...smsFields,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  const businessUpdate: Record<string, unknown> = {
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!isTrialing) {
    businessUpdate.billing_status = "active";
    businessUpdate.accountStatus = "active";
    businessUpdate.status = "active";
    businessUpdate.isActive = true;
  }

  await ref.update(businessUpdate);

  if (ownerUid && !isTrialing) {
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
