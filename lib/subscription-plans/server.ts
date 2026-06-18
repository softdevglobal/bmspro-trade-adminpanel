import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { DEFAULT_SUBSCRIPTION_PLAN_SEEDS } from "@/lib/subscription-plans/defaults";
import {
  formatBillingNote,
  formatPeriodLabel,
  formatPriceLabel,
  normalizeBillingCycle,
  validatePlanDescription,
  validityDaysForCycle,
} from "@/lib/subscription-plans/helpers";
import { normalizePlanThemeId } from "@/lib/subscription-plans/theme";
import {
  SUBSCRIPTION_PLANS_COLLECTION,
  type SubscriptionPlan,
  type SubscriptionPlanInput,
} from "@/lib/subscription-plans/types";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

function mapPlanDoc(id: string, data: DocumentData): SubscriptionPlan {
  const billingCycle = normalizeBillingCycle(data.billingCycle);
  const validityDays =
    typeof data.validityDays === "number" && Number.isFinite(data.validityDays)
      ? data.validityDays
      : validityDaysForCycle(billingCycle);
  const price =
    typeof data.price === "number" && Number.isFinite(data.price)
      ? data.price
      : 0;

  return {
    id,
    name: typeof data.name === "string" ? data.name : "Plan",
    price,
    priceLabel:
      typeof data.priceLabel === "string" && data.priceLabel.trim()
        ? data.priceLabel.trim()
        : formatPriceLabel(price, billingCycle),
    staff:
      typeof data.staff === "number" && Number.isFinite(data.staff) ? data.staff : 5,
    features: Array.isArray(data.features)
      ? data.features.filter((f): f is string => typeof f === "string")
      : [],
    popular: data.popular === true,
    color: normalizePlanThemeId(data.color),
    image: typeof data.image === "string" ? data.image : "",
    icon: typeof data.icon === "string" ? data.icon : "inventory_2",
    active: data.active !== false,
    hidden: data.hidden === true,
    stripePriceId:
      typeof data.stripePriceId === "string" && data.stripePriceId.trim()
        ? data.stripePriceId.trim()
        : null,
    trialDays:
      typeof data.trialDays === "number" && Number.isFinite(data.trialDays)
        ? Math.max(0, data.trialDays)
        : 0,
    plan_key:
      typeof data.plan_key === "string" && data.plan_key.trim()
        ? data.plan_key.trim()
        : null,
    billingCycle,
    validityDays,
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : null,
    smsPackageId:
      typeof data.smsPackageId === "string" && data.smsPackageId.trim()
        ? data.smsPackageId.trim()
        : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function normalisePlanInput(input: SubscriptionPlanInput): Record<string, unknown> {
  const billingCycle = normalizeBillingCycle(input.billingCycle);
  const validityDays = validityDaysForCycle(billingCycle);
  const price = Number.isFinite(input.price) ? input.price : 0;

  return {
    name: input.name.trim(),
    price,
    priceLabel:
      input.priceLabel?.trim() || formatPriceLabel(price, billingCycle),
    staff: Number.isFinite(input.staff) ? input.staff : 5,
    features: Array.isArray(input.features)
      ? input.features.filter((f) => typeof f === "string" && f.trim())
      : [],
    popular: input.popular === true,
    color: normalizePlanThemeId(input.color),
    image: input.image?.trim() || "",
    icon: input.icon?.trim() || "inventory_2",
    active: input.active !== false,
    hidden: input.hidden === true,
    stripePriceId: input.stripePriceId?.trim() || null,
    trialDays:
      typeof input.trialDays === "number" && Number.isFinite(input.trialDays)
        ? Math.max(0, input.trialDays)
        : 0,
    plan_key: input.plan_key?.trim() || null,
    billingCycle,
    validityDays,
    description: input.description?.trim() || null,
    smsPackageId: input.smsPackageId?.trim() || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Seeds default plans when the catalog is empty. */
export async function ensureDefaultSubscriptionPlans(): Promise<void> {
  const snap = await adminDb.collection(SUBSCRIPTION_PLANS_COLLECTION).limit(1).get();
  if (!snap.empty) return;

  const { ensureDefaultSmsPackages } = await import("@/lib/sms-packages/server");
  await ensureDefaultSmsPackages();

  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();

  for (const seed of DEFAULT_SUBSCRIPTION_PLAN_SEEDS) {
    const ref = adminDb.collection(SUBSCRIPTION_PLANS_COLLECTION).doc(seed.id);
    batch.set(ref, {
      ...normalisePlanInput(seed.input),
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
}

export async function listSubscriptionPlans(options?: {
  includeInactive?: boolean;
  includeHidden?: boolean;
}): Promise<SubscriptionPlan[]> {
  await ensureDefaultSubscriptionPlans();

  const snap = await adminDb.collection(SUBSCRIPTION_PLANS_COLLECTION).get();
  let plans = snap.docs.map((doc) => mapPlanDoc(doc.id, doc.data() ?? {}));

  if (!options?.includeInactive) {
    plans = plans.filter((plan) => plan.active);
  }
  if (!options?.includeHidden) {
    plans = plans.filter((plan) => !plan.hidden);
  }

  plans.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  return plans;
}

export async function getSubscriptionPlanById(
  planId: string,
): Promise<SubscriptionPlan | null> {
  const trimmed = planId.trim();
  if (!trimmed) return null;

  await ensureDefaultSubscriptionPlans();

  const snap = await adminDb
    .collection(SUBSCRIPTION_PLANS_COLLECTION)
    .doc(trimmed)
    .get();
  if (!snap.exists) return null;
  return mapPlanDoc(snap.id, snap.data() ?? {});
}

export async function createSubscriptionPlan(
  input: SubscriptionPlanInput,
): Promise<SubscriptionPlan> {
  const name = input.name?.trim();
  if (!name || name.length < 2) {
    throw new Error("Plan name is required.");
  }

  const description = validatePlanDescription(input.description);
  if (!description.ok) {
    throw new Error(description.error);
  }

  const ref = adminDb.collection(SUBSCRIPTION_PLANS_COLLECTION).doc();
  const data = {
    ...normalisePlanInput({ ...input, name, description: description.value }),
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(data);
  const snap = await ref.get();
  return mapPlanDoc(ref.id, snap.data() ?? {});
}

export async function updateSubscriptionPlan(
  planId: string,
  input: Partial<SubscriptionPlanInput>,
): Promise<SubscriptionPlan | null> {
  const ref = adminDb.collection(SUBSCRIPTION_PLANS_COLLECTION).doc(planId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const existing = mapPlanDoc(snap.id, snap.data() ?? {});
  const merged: SubscriptionPlanInput = {
    name: input.name?.trim() || existing.name,
    price: input.price ?? existing.price,
    priceLabel: input.priceLabel ?? existing.priceLabel,
    staff: input.staff ?? existing.staff,
    features: input.features ?? existing.features,
    popular: input.popular ?? existing.popular,
    color: input.color ?? existing.color,
    image: input.image ?? existing.image,
    icon: input.icon ?? existing.icon,
    active: input.active ?? existing.active,
    hidden: input.hidden ?? existing.hidden,
    stripePriceId:
      input.stripePriceId !== undefined
        ? input.stripePriceId
        : existing.stripePriceId,
    trialDays: input.trialDays ?? existing.trialDays,
    plan_key: input.plan_key !== undefined ? input.plan_key : existing.plan_key,
    billingCycle: input.billingCycle ?? existing.billingCycle,
    description:
      input.description !== undefined ? input.description : existing.description,
    smsPackageId:
      input.smsPackageId !== undefined
        ? input.smsPackageId
        : existing.smsPackageId,
  };

  const description = validatePlanDescription(merged.description);
  if (!description.ok) {
    throw new Error(description.error);
  }
  merged.description = description.value;

  await ref.update(normalisePlanInput(merged));
  const updated = await ref.get();
  return mapPlanDoc(planId, updated.data() ?? {});
}

export async function deleteSubscriptionPlan(planId: string): Promise<boolean> {
  const ref = adminDb.collection(SUBSCRIPTION_PLANS_COLLECTION).doc(planId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

/** Plan fields written onto businesses and owner users at tenant creation. */
export function buildTenantSubscriptionFields(plan: SubscriptionPlan): {
  business: Record<string, unknown>;
  ownerUser: Record<string, unknown>;
} {
  const now = Date.now();
  const trialMs =
    plan.trialDays > 0 ? plan.trialDays * 24 * 60 * 60 * 1000 : 0;
  const trialEnd = trialMs > 0 ? now + trialMs : null;
  const hasTrial = plan.trialDays > 0;
  const billingStatus = hasTrial ? "trialing" : "pending";
  const accountStatus = hasTrial ? "active_trial" : "pending_payment";
  const periodMs = plan.validityDays * 24 * 60 * 60 * 1000;

  const businessPlan = {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    priceLabel: plan.priceLabel,
    period: formatPeriodLabel(plan.validityDays),
    trialDays: plan.trialDays > 0 ? plan.trialDays : null,
    plan_key: plan.plan_key,
    billingCycle: plan.billingCycle,
    validityDays: plan.validityDays,
    staff: plan.staff,
  };

  return {
    business: {
      planId: plan.id,
      plan: businessPlan,
      staffLimit: plan.staff,
      currentStaffCount: 0,
      billing_status: billingStatus,
      accountStatus,
      trialDays: plan.trialDays,
      hasFreeTrial: hasTrial,
      ...(hasTrial
        ? {
            trial_start: now,
            trial_end: trialEnd,
          }
        : {}),
      subscriptionPeriodStart: now,
      subscriptionPeriodEnd: now + periodMs,
    },
    ownerUser: {
      planId: plan.id,
      plan: plan.name,
      plan_key: plan.plan_key,
      price: plan.priceLabel,
      staffLimit: plan.staff,
      currentStaffCount: 0,
      billing_status: billingStatus,
      accountStatus,
      trialDays: plan.trialDays,
      hasFreeTrial: hasTrial,
      ...(hasTrial
        ? {
            trial_start: now,
            trial_end: trialEnd,
          }
        : {}),
    },
  };
}

export function planBillingNote(plan: SubscriptionPlan): string {
  return formatBillingNote(plan.billingCycle, plan.validityDays);
}

/**
 * Advances the subscription billing period without re-granting bundled SMS.
 * Call from Stripe/webhook renewal handlers — SMS top-ups are purchased separately.
 */
export async function renewTenantSubscription(
  businessId: string,
): Promise<void> {
  const trimmedId = businessId.trim();
  if (!trimmedId) {
    throw new Error("Business id is required.");
  }

  const ref = adminDb.collection("businesses").doc(trimmedId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Business not found.");
  }

  const data = snap.data() ?? {};
  const planId =
    typeof data.planId === "string" && data.planId.trim()
      ? data.planId.trim()
      : typeof (data.plan as { id?: string } | undefined)?.id === "string"
        ? (data.plan as { id: string }).id
        : null;

  const plan = planId ? await getSubscriptionPlanById(planId) : null;
  const validityDays =
    plan?.validityDays ??
    (typeof (data.plan as { validityDays?: number } | undefined)?.validityDays ===
      "number"
      ? (data.plan as { validityDays: number }).validityDays
      : 28);

  const now = Date.now();
  const periodMs = validityDays * 24 * 60 * 60 * 1000;

  await ref.update({
    subscriptionPeriodStart: now,
    subscriptionPeriodEnd: now + periodMs,
    billing_status: "active",
    accountStatus: "active",
    smsBundleFirstPeriodOnly: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** Count businesses on each subscription plan (by planId or legacy plan.id). */
export async function countTenantsByPlan(): Promise<Record<string, number>> {
  const snapshot = await adminDb.collection("businesses").get();
  const counts: Record<string, number> = {};

  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    const planId =
      typeof data.planId === "string" && data.planId.trim()
        ? data.planId.trim()
        : typeof (data.plan as { id?: string } | undefined)?.id === "string"
          ? (data.plan as { id: string }).id
          : null;
    if (!planId) continue;
    counts[planId] = (counts[planId] ?? 0) + 1;
  }

  return counts;
}
