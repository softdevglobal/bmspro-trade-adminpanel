import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import {
  parseBusinessSmsFields,
  type BusinessSmsBalance,
} from "@/lib/sms-packages/balance";
import { DEFAULT_SMS_PACKAGE_SEEDS } from "@/lib/sms-packages/defaults";
import {
  formatSmsPriceLabel,
  validateSmsPackageDescription,
} from "@/lib/sms-packages/helpers";
import { normalizePlanThemeId } from "@/lib/subscription-plans/theme";
import {
  SMS_PACKAGES_COLLECTION,
  type SmsPackage,
  type SmsPackageInput,
} from "@/lib/sms-packages/types";
import type { SubscriptionPlan } from "@/lib/subscription-plans/types";
import type { BundledSmsPackageSummary } from "@/lib/subscription-plans/display";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

function mapSmsPackageDoc(id: string, data: DocumentData): SmsPackage {
  const price =
    typeof data.price === "number" && Number.isFinite(data.price)
      ? data.price
      : 0;

  return {
    id,
    name: typeof data.name === "string" ? data.name : "SMS Package",
    price,
    priceLabel:
      typeof data.priceLabel === "string" && data.priceLabel.trim()
        ? data.priceLabel.trim()
        : formatSmsPriceLabel(price),
    messageQuota:
      typeof data.messageQuota === "number" && Number.isFinite(data.messageQuota)
        ? data.messageQuota
        : 100,
    features: Array.isArray(data.features)
      ? data.features.filter((f): f is string => typeof f === "string")
      : [],
    popular: data.popular === true,
    color: normalizePlanThemeId(data.color),
    image: typeof data.image === "string" ? data.image : "",
    icon: typeof data.icon === "string" ? data.icon : "sms",
    active: data.active !== false,
    hidden: data.hidden === true,
    stripePriceId:
      typeof data.stripePriceId === "string" && data.stripePriceId.trim()
        ? data.stripePriceId.trim()
        : null,
    plan_key:
      typeof data.plan_key === "string" && data.plan_key.trim()
        ? data.plan_key.trim()
        : null,
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function normaliseSmsPackageInput(
  input: SmsPackageInput,
): Record<string, unknown> {
  const price = Number.isFinite(input.price) ? input.price : 0;

  return {
    name: input.name.trim(),
    price,
    priceLabel:
      input.priceLabel?.trim() || formatSmsPriceLabel(price),
    messageQuota: Number.isFinite(input.messageQuota) ? input.messageQuota : 100,
    features: Array.isArray(input.features)
      ? input.features.filter((f) => typeof f === "string" && f.trim())
      : [],
    popular: input.popular === true,
    color: normalizePlanThemeId(input.color),
    image: input.image?.trim() || "",
    icon: input.icon?.trim() || "sms",
    active: input.active !== false,
    hidden: input.hidden === true,
    stripePriceId: input.stripePriceId?.trim() || null,
    plan_key: input.plan_key?.trim() || null,
    description: input.description?.trim() || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Seeds default SMS packages when the catalog is empty. */
export async function ensureDefaultSmsPackages(): Promise<void> {
  const snap = await adminDb.collection(SMS_PACKAGES_COLLECTION).limit(1).get();
  if (!snap.empty) return;

  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();

  for (const seed of DEFAULT_SMS_PACKAGE_SEEDS) {
    const ref = adminDb.collection(SMS_PACKAGES_COLLECTION).doc(seed.id);
    batch.set(ref, {
      ...normaliseSmsPackageInput(seed.input),
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();
}

export async function listSmsPackages(options?: {
  includeInactive?: boolean;
  includeHidden?: boolean;
}): Promise<SmsPackage[]> {
  await ensureDefaultSmsPackages();

  const snap = await adminDb.collection(SMS_PACKAGES_COLLECTION).get();
  let packages = snap.docs.map((doc) => mapSmsPackageDoc(doc.id, doc.data() ?? {}));

  if (!options?.includeInactive) {
    packages = packages.filter((pkg) => pkg.active);
  }
  if (!options?.includeHidden) {
    packages = packages.filter((pkg) => !pkg.hidden);
  }

  packages.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  return packages;
}

export async function getSmsPackageById(
  packageId: string,
): Promise<SmsPackage | null> {
  const trimmed = packageId.trim();
  if (!trimmed) return null;

  await ensureDefaultSmsPackages();

  const snap = await adminDb
    .collection(SMS_PACKAGES_COLLECTION)
    .doc(trimmed)
    .get();
  if (!snap.exists) return null;
  return mapSmsPackageDoc(snap.id, snap.data() ?? {});
}

export async function createSmsPackage(
  input: SmsPackageInput,
): Promise<SmsPackage> {
  const name = input.name?.trim();
  if (!name || name.length < 2) {
    throw new Error("SMS package name is required.");
  }

  const description = validateSmsPackageDescription(input.description);
  if (!description.ok) {
    throw new Error(description.error);
  }

  const ref = adminDb.collection(SMS_PACKAGES_COLLECTION).doc();
  const data = {
    ...normaliseSmsPackageInput({ ...input, name, description: description.value }),
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(data);
  const snap = await ref.get();
  return mapSmsPackageDoc(ref.id, snap.data() ?? {});
}

export async function updateSmsPackage(
  packageId: string,
  input: Partial<SmsPackageInput>,
): Promise<SmsPackage | null> {
  const ref = adminDb.collection(SMS_PACKAGES_COLLECTION).doc(packageId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const existing = mapSmsPackageDoc(snap.id, snap.data() ?? {});
  const merged: SmsPackageInput = {
    name: input.name?.trim() || existing.name,
    price: input.price ?? existing.price,
    priceLabel: input.priceLabel ?? existing.priceLabel,
    messageQuota: input.messageQuota ?? existing.messageQuota,
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
    plan_key: input.plan_key !== undefined ? input.plan_key : existing.plan_key,
    description:
      input.description !== undefined ? input.description : existing.description,
  };

  const description = validateSmsPackageDescription(merged.description);
  if (!description.ok) {
    throw new Error(description.error);
  }
  merged.description = description.value;

  await ref.update(normaliseSmsPackageInput(merged));
  const updated = await ref.get();
  return mapSmsPackageDoc(packageId, updated.data() ?? {});
}

export async function deleteSmsPackage(packageId: string): Promise<boolean> {
  const ref = adminDb.collection(SMS_PACKAGES_COLLECTION).doc(packageId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

/** SMS package fields written onto businesses at tenant creation. */
export function buildTenantSmsFields(
  pkg: SmsPackage,
  options?: { subscriptionValidityDays?: number },
): Record<string, unknown> {
  const now = Date.now();
  const validityDays =
    typeof options?.subscriptionValidityDays === "number" &&
    Number.isFinite(options.subscriptionValidityDays) &&
    options.subscriptionValidityDays > 0
      ? options.subscriptionValidityDays
      : 28;

  return {
    smsPackageId: pkg.id,
    smsPackage: snapshotSmsPackage(pkg),
    smsMessageLimit: pkg.messageQuota,
    smsMessagesUsed: 0,
    smsBundleQuota: pkg.messageQuota,
    smsBundleRenewsWithPlan: true,
    smsBundleGrantedAt: now,
    smsBundlePeriodEnd: now + validityDays * 24 * 60 * 60 * 1000,
  };
}

function snapshotSmsPackage(pkg: SmsPackage): Record<string, unknown> {
  return {
    id: pkg.id,
    name: pkg.name,
    price: pkg.price,
    priceLabel: pkg.priceLabel,
    messageQuota: pkg.messageQuota,
    plan_key: pkg.plan_key,
  };
}

function resolveStoredBundleQuota(data: Record<string, unknown>): number {
  if (
    typeof data.smsBundleQuota === "number" &&
    Number.isFinite(data.smsBundleQuota)
  ) {
    return data.smsBundleQuota;
  }
  const smsPackage = data.smsPackage as { messageQuota?: number } | null | undefined;
  if (
    typeof smsPackage?.messageQuota === "number" &&
    Number.isFinite(smsPackage.messageQuota)
  ) {
    return smsPackage.messageQuota;
  }
  return 0;
}

/**
 * Re-grants the plan's bundled SMS on subscription renewal.
 * Purchased top-ups above the previous bundle allowance are preserved.
 */
export function buildTenantSmsRenewalFields(
  pkg: SmsPackage,
  businessData: Record<string, unknown>,
): Record<string, unknown> {
  const now = Date.now();
  const previousBundle = resolveStoredBundleQuota(businessData);
  const currentLimit =
    typeof businessData.smsMessageLimit === "number" &&
    Number.isFinite(businessData.smsMessageLimit)
      ? businessData.smsMessageLimit
      : previousBundle;
  const purchasedExtra =
    previousBundle < 0 || pkg.messageQuota < 0
      ? 0
      : Math.max(0, currentLimit - previousBundle);
  const newBundleQuota = pkg.messageQuota;
  const newLimit =
    newBundleQuota < 0 ? -1 : Math.max(0, newBundleQuota) + purchasedExtra;

  return {
    smsPackageId: pkg.id,
    smsPackage: snapshotSmsPackage(pkg),
    smsMessageLimit: newLimit,
    smsMessagesUsed: 0,
    smsBundleQuota: newBundleQuota,
    smsBundleRenewsWithPlan: true,
    smsBundleRenewedAt: now,
  };
}

/** Resolve the SMS package bundled with a subscription plan. */
export async function resolveSmsPackageForPlan(
  plan: SubscriptionPlan,
): Promise<SmsPackage | null> {
  if (plan.smsPackageId) {
    const linked = await getSmsPackageById(plan.smsPackageId);
    if (linked?.active) return linked;
  }

  const packages = await listSmsPackages({
    includeInactive: false,
    includeHidden: false,
  });
  return packages[0] ?? null;
}

function toBundledSmsSummary(pkg: SmsPackage): BundledSmsPackageSummary {
  return {
    id: pkg.id,
    name: pkg.name,
    priceLabel: pkg.priceLabel,
    messageQuota: pkg.messageQuota,
    description: pkg.description,
    features: pkg.features,
  };
}

/** Attach bundled SMS package details for plan cards in onboarding and admin UI. */
export async function enrichPlansWithBundledSms<T extends SubscriptionPlan>(
  plans: T[],
): Promise<(T & { bundledSmsPackage: BundledSmsPackageSummary | null })[]> {
  await ensureDefaultSmsPackages();
  const allSms = await listSmsPackages({
    includeInactive: true,
    includeHidden: true,
  });
  const defaultSms =
    allSms.find((pkg) => pkg.active && !pkg.hidden) ?? allSms[0] ?? null;
  const byId = new Map(allSms.map((pkg) => [pkg.id, pkg]));

  return plans.map((plan) => {
    const linked = plan.smsPackageId ? byId.get(plan.smsPackageId) : null;
    const pkg = linked ?? defaultSms;
    return {
      ...plan,
      bundledSmsPackage: pkg ? toBundledSmsSummary(pkg) : null,
    };
  });
}

/** Count businesses on each SMS package (by smsPackageId). */
export async function countTenantsBySmsPackage(): Promise<Record<string, number>> {
  const snapshot = await adminDb.collection("businesses").get();
  const counts: Record<string, number> = {};

  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    const packageId =
      typeof data.smsPackageId === "string" && data.smsPackageId.trim()
        ? data.smsPackageId.trim()
        : typeof (data.smsPackage as { id?: string } | undefined)?.id === "string"
          ? (data.smsPackage as { id: string }).id
          : null;
    if (!packageId) continue;
    counts[packageId] = (counts[packageId] ?? 0) + 1;
  }

  return counts;
}

/** Reads SMS balance for a business tenant. */
export async function getBusinessSmsBalance(
  businessId: string,
): Promise<BusinessSmsBalance | null> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) return null;
  return parseBusinessSmsFields(snap.data() ?? {});
}

/** Adds SMS credits from a catalog package to a business. */
export async function purchaseSmsPackageForBusiness(
  businessId: string,
  packageId: string,
): Promise<BusinessSmsBalance> {
  const trimmedId = packageId.trim();
  if (!trimmedId) {
    throw new Error("SMS package id is required.");
  }

  const pkg = await getSmsPackageById(trimmedId);
  if (!pkg || !pkg.active || pkg.hidden) {
    throw new Error("SMS package not found or unavailable.");
  }

  const ref = adminDb.collection("businesses").doc(businessId);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error("Business not found.");
    }

    const current = parseBusinessSmsFields(snap.data() ?? {});
    const quota = pkg.messageQuota;
    const newLimit =
      current.isUnlimited || quota < 0
        ? -1
        : Math.max(0, current.limit) + quota;

    tx.update(ref, {
      smsMessageLimit: newLimit,
      smsPackageId: pkg.id,
      smsPackage: {
        id: pkg.id,
        name: pkg.name,
        price: pkg.price,
        priceLabel: pkg.priceLabel,
        messageQuota: pkg.messageQuota,
        plan_key: pkg.plan_key,
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const balance = await getBusinessSmsBalance(businessId);
  if (!balance) {
    throw new Error("Could not load SMS balance.");
  }
  return balance;
}
