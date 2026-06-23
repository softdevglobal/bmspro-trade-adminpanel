import "server-only";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import {
  buildTenantSubscriptionFields,
  getSubscriptionPlanById,
  listSubscriptionPlans,
} from "@/lib/subscription-plans/server";
import type { SubscriptionPlan } from "@/lib/subscription-plans/types";
import {
  buildTenantSmsRenewalFields,
  enrichPlansWithBundledSms,
  resolveSmsPackageForPlan,
} from "@/lib/sms-packages/server";
import { parseBusinessSmsFields } from "@/lib/sms-packages/balance";
import { normalizeBillingCycle } from "@/lib/subscription-plans/helpers";
import type {
  AvailablePlanOption,
  BundledSmsSnapshot,
  PlanChangeAssessment,
  PlanChangeDirection,
  TenantSubscriptionSnapshot,
} from "@/lib/subscription-plans/tenant-types";
import { isTenantSubscriptionAccessBlocked } from "@/lib/subscription-plans/access";

export type {
  AvailablePlanOption,
  PlanChangeAssessment,
  PlanChangeDirection,
  TenantSubscriptionSnapshot,
} from "@/lib/subscription-plans/tenant-types";

export async function countBusinessStaff(businessId: string): Promise<number> {
  const snapshot = await adminDb
    .collection("users")
    .where("businessId", "==", businessId)
    .where("role", "==", "staff")
    .get();
  return snapshot.size;
}

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

export async function getTenantSubscriptionSnapshot(
  businessId: string,
): Promise<TenantSubscriptionSnapshot | null> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  const planId = resolveStoredPlanId(data);
  const planRaw = data.plan as
    | { name?: string; priceLabel?: string }
    | null
    | undefined;
  const staffLimit =
    typeof data.staffLimit === "number" && Number.isFinite(data.staffLimit)
      ? data.staffLimit
      : typeof (planRaw as { staff?: number } | undefined)?.staff === "number"
        ? (planRaw as { staff: number }).staff
        : 0;

  const staffCountPromise = countBusinessStaff(businessId);

  const billingStatus =
    typeof data.billing_status === "string" ? data.billing_status : null;
  const accountStatus =
    typeof data.accountStatus === "string" ? data.accountStatus : null;
  const stripeSubscriptionId =
    typeof data.stripeSubscriptionId === "string"
      ? data.stripeSubscriptionId
      : null;
  const trialStart = toMillis(data.trial_start);
  const trialEnd = toMillis(data.trial_end);
  const trialDays =
    typeof data.trialDays === "number" && Number.isFinite(data.trialDays)
      ? Math.max(0, data.trialDays)
      : 0;
  const hasFreeTrial = data.hasFreeTrial === true || trialDays > 0;
  const subscriptionPeriodEnd = toMillis(data.subscriptionPeriodEnd);
  const subscriptionPeriodStart = toMillis(data.subscriptionPeriodStart);
  const planEmbedded = data.plan as
    | { validityDays?: number; billingCycle?: string }
    | null
    | undefined;
  const validityDays =
    typeof planEmbedded?.validityDays === "number" &&
    Number.isFinite(planEmbedded.validityDays)
      ? planEmbedded.validityDays
      : typeof data.validityDays === "number" && Number.isFinite(data.validityDays)
        ? data.validityDays
        : 28;
  const billingCycleRaw =
    typeof planEmbedded?.billingCycle === "string"
      ? planEmbedded.billingCycle
      : typeof data.billingCycle === "string"
        ? data.billingCycle
        : null;
  const billingCycle = billingCycleRaw
    ? normalizeBillingCycle(billingCycleRaw)
    : null;

  const smsBalance = parseBusinessSmsFields(data);
  const smsBundlePeriodEnd = toMillis(data.smsBundlePeriodEnd);
  const smsBundleRenewsWithPlan = data.smsBundleRenewsWithPlan === true;

  const isTrialing =
    billingStatus === "trialing" || accountStatus === "active_trial";
  const needsPayment =
    !stripeSubscriptionId &&
    (isTrialing ||
      billingStatus === "pending" ||
      accountStatus === "pending_payment");

  let bundledSmsPackage: BundledSmsSnapshot = null;
  const bundledSmsPromise = planId
    ? getSubscriptionPlanById(planId).then(async (plan) => {
        if (!plan) return;
        const [enriched] = await enrichPlansWithBundledSms([plan]);
        const bundled = enriched.bundledSmsPackage;
        if (bundled) {
          bundledSmsPackage = {
            id: bundled.id,
            name: bundled.name,
            messageQuota: bundled.messageQuota,
            priceLabel: bundled.priceLabel,
          };
        }
      })
    : Promise.resolve();

  const staffCount = await staffCountPromise;
  await bundledSmsPromise;

  const snapshotBase = {
    planId,
    planName:
      typeof planRaw?.name === "string" && planRaw.name.trim()
        ? planRaw.name.trim()
        : null,
    planPriceLabel:
      typeof planRaw?.priceLabel === "string" && planRaw.priceLabel.trim()
        ? planRaw.priceLabel.trim()
        : null,
    staffLimit,
    staffCount,
    billingStatus,
    accountStatus,
    subscriptionPeriodStart,
    subscriptionPeriodEnd,
    stripeSubscriptionId,
    hasStripeCustomer:
      typeof data.stripeCustomerId === "string" &&
      Boolean(data.stripeCustomerId.trim()),
    hasFreeTrial,
    trialStart,
    trialEnd,
    trialDays,
    validityDays,
    billingCycle,
    bundledSmsPackage,
    smsLimit: smsBalance.limit,
    smsUsed: smsBalance.used,
    smsRemaining: smsBalance.remaining,
    smsBundlePeriodEnd,
    smsBundleRenewsWithPlan,
    needsPaymentDetails: needsPayment,
    isTrialing,
  };

  return {
    ...snapshotBase,
    accessBlocked: isTenantSubscriptionAccessBlocked(snapshotBase),
  };
}

export function planChangeDirection(
  current: SubscriptionPlan | null,
  target: SubscriptionPlan,
): PlanChangeDirection {
  if (!current || current.id === target.id) return "same";
  if (target.price > current.price) return "upgrade";
  if (target.price < current.price) return "downgrade";
  if (target.staff > current.staff) return "upgrade";
  if (target.staff < current.staff) return "downgrade";
  return "upgrade";
}

export function assessPlanChangeForStaff(
  staffCount: number,
  targetPlan: SubscriptionPlan,
  direction: PlanChangeDirection,
): PlanChangeAssessment {
  const targetStaffLimit = targetPlan.staff;
  const unlimited = targetStaffLimit < 0;

  if (
    direction === "downgrade" &&
    !unlimited &&
    staffCount > targetStaffLimit
  ) {
    const over = staffCount - targetStaffLimit;
    return {
      direction,
      allowed: false,
      blockReason: `You have ${staffCount} staff but ${targetPlan.name} allows ${targetStaffLimit}. Remove ${over} staff member${over === 1 ? "" : "s"} in Team management before downgrading.`,
      staffCount,
      currentStaffLimit: targetStaffLimit,
      targetStaffLimit,
    };
  }

  return {
    direction,
    allowed: true,
    blockReason: null,
    staffCount,
    currentStaffLimit: targetStaffLimit,
    targetStaffLimit,
  };
}

export async function assessPlanChange(
  businessId: string,
  targetPlanId: string,
): Promise<
  | { ok: true; assessment: PlanChangeAssessment; targetPlan: SubscriptionPlan }
  | { ok: false; error: string }
> {
  const targetPlan = await getSubscriptionPlanById(targetPlanId.trim());
  if (!targetPlan || !targetPlan.active || targetPlan.hidden) {
    return { ok: false, error: "Subscription plan not found or unavailable." };
  }

  const snapshot = await getTenantSubscriptionSnapshot(businessId);
  if (!snapshot) {
    return { ok: false, error: "Business not found." };
  }

  const currentPlan = snapshot.planId
    ? await getSubscriptionPlanById(snapshot.planId)
    : null;
  const direction = planChangeDirection(currentPlan, targetPlan);
  const assessment = assessPlanChangeForStaff(
    snapshot.staffCount,
    targetPlan,
    direction,
  );

  return { ok: true, assessment, targetPlan };
}

/** Applies a new subscription plan to an active tenant (upgrade/downgrade). */
export async function applyPlanChangeToTenant(
  businessId: string,
  planId: string,
): Promise<void> {
  const check = await assessPlanChange(businessId, planId);
  if (!check.ok) {
    throw new Error(check.error);
  }
  if (!check.assessment.allowed) {
    throw new Error(check.assessment.blockReason ?? "Plan change not allowed.");
  }

  const plan = check.targetPlan;
  const ref = adminDb.collection("businesses").doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Business not found.");
  }

  const data = snap.data() ?? {};
  const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid : null;
  const staffCount = check.assessment.staffCount;
  const subscriptionFields = buildTenantSubscriptionFields(plan);
  const now = Date.now();
  const periodMs = plan.validityDays * 24 * 60 * 60 * 1000;
  const smsPackage = await resolveSmsPackageForPlan(plan);
  const smsFields = smsPackage
    ? buildTenantSmsRenewalFields(smsPackage, data, {
        periodEndMs: now + periodMs,
      })
    : {};

  const batch = adminDb.batch();
  batch.update(ref, {
    ...subscriptionFields.business,
    staffLimit: plan.staff,
    currentStaffCount: staffCount,
    billing_status: "active",
    accountStatus: "active",
    status: "active",
    isActive: true,
    subscriptionPeriodStart: now,
    subscriptionPeriodEnd: now + periodMs,
    ...smsFields,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (ownerUid) {
    batch.update(adminDb.collection("users").doc(ownerUid), {
      ...subscriptionFields.ownerUser,
      staffLimit: plan.staff,
      currentStaffCount: staffCount,
      billing_status: "active",
      accountStatus: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

export async function listAvailablePlansForTenant(
  businessId: string,
): Promise<{
  snapshot: TenantSubscriptionSnapshot;
  plans: AvailablePlanOption[];
}> {
  const [snapshot, plans] = await Promise.all([
    getTenantSubscriptionSnapshot(businessId),
    listSubscriptionPlans({
      includeInactive: false,
      includeHidden: false,
    }),
  ]);

  if (!snapshot) {
    throw new Error("Business not found.");
  }

  const withSms = await enrichPlansWithBundledSms(plans);
  const currentPlan = snapshot.planId
    ? (withSms.find((plan) => plan.id === snapshot.planId) ?? null)
    : null;

  const options: AvailablePlanOption[] = withSms.map((plan) => {
    const direction = planChangeDirection(currentPlan, plan);
    const assessment = assessPlanChangeForStaff(
      snapshot.staffCount,
      plan,
      direction,
    );
    return {
      ...plan,
      direction,
      changeAllowed: plan.id !== snapshot.planId && assessment.allowed,
      blockReason: assessment.blockReason,
    };
  });

  return { snapshot, plans: options };
}
