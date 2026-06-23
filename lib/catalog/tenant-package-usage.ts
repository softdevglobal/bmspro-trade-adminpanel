import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type {
  TenantPackagePurchaseEntry,
  TenantPackageUsageCatalog,
  TenantPackageUsageEntry,
} from "@/lib/catalog/tenant-package-usage-types";
import { parseBusinessSmsFields } from "@/lib/sms-packages/balance";
import { listSmsPackages } from "@/lib/sms-packages/server";
import { listSubscriptionPlans } from "@/lib/subscription-plans/server";

const FULFILLED_SESSIONS = "stripe_fulfilled_sessions";

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

function resolvePlanId(data: Record<string, unknown>): string | null {
  if (typeof data.planId === "string" && data.planId.trim()) {
    return data.planId.trim();
  }
  const embedded = data.plan as { id?: string } | null | undefined;
  if (embedded && typeof embedded.id === "string" && embedded.id.trim()) {
    return embedded.id.trim();
  }
  return null;
}

function resolveSmsPackageId(data: Record<string, unknown>): string | null {
  if (typeof data.smsPackageId === "string" && data.smsPackageId.trim()) {
    return data.smsPackageId.trim();
  }
  const embedded = data.smsPackage as { id?: string } | null | undefined;
  if (embedded && typeof embedded.id === "string" && embedded.id.trim()) {
    return embedded.id.trim();
  }
  return null;
}

type OwnerProfile = {
  fullName: string | null;
  email: string | null;
};

function resolveOwnerFromData(
  data: Record<string, unknown>,
  ownerProfiles: Map<string, OwnerProfile>,
): { ownerName: string | null; ownerEmail: string | null } {
  const owner = data.owner as
    | { email?: string; fullName?: string; firstName?: string; lastName?: string }
    | null
    | undefined;
  const ownerUid =
    typeof data.ownerUid === "string" && data.ownerUid.trim()
      ? data.ownerUid.trim()
      : null;
  const profile = ownerUid ? ownerProfiles.get(ownerUid) : undefined;

  const ownerJoined = [owner?.firstName, owner?.lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .trim();

  const ownerName =
    (typeof owner?.fullName === "string" && owner.fullName.trim()
      ? owner.fullName.trim()
      : null) ??
    (ownerJoined || null) ??
    profile?.fullName ??
    null;

  const ownerEmail =
    (typeof owner?.email === "string" && owner.email.trim()
      ? owner.email.trim()
      : null) ??
    (typeof data.businessEmail === "string" && data.businessEmail.trim()
      ? data.businessEmail.trim()
      : null) ??
    profile?.email ??
    null;

  return { ownerName, ownerEmail };
}

async function loadOwnerProfiles(
  businessDocs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<Map<string, OwnerProfile>> {
  const uids = new Set<string>();
  for (const doc of businessDocs) {
    const uid = doc.data()?.ownerUid;
    if (typeof uid === "string" && uid.trim()) {
      uids.add(uid.trim());
    }
  }

  const profiles = new Map<string, OwnerProfile>();
  await Promise.all(
    [...uids].map(async (uid) => {
      const snap = await adminDb.collection("users").doc(uid).get();
      if (!snap.exists) return;
      const userData = snap.data() ?? {};
      profiles.set(uid, {
        fullName:
          typeof userData.fullName === "string" && userData.fullName.trim()
            ? userData.fullName.trim()
            : typeof userData.displayName === "string" &&
                userData.displayName.trim()
              ? userData.displayName.trim()
              : null,
        email:
          typeof userData.email === "string" && userData.email.trim()
            ? userData.email.trim()
            : null,
      });
    }),
  );

  return profiles;
}

/** Resolves tenant display name and owner from a business document. */
export async function resolveBusinessOwnerInfo(businessId: string): Promise<{
  businessName: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
}> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) {
    return { businessName: null, ownerName: null, ownerEmail: null };
  }
  const data = snap.data() ?? {};
  const profiles = await loadOwnerProfiles([snap as FirebaseFirestore.QueryDocumentSnapshot]);
  const { ownerName, ownerEmail } = resolveOwnerFromData(data, profiles);
  const businessName =
    typeof data.businessName === "string" && data.businessName.trim()
      ? data.businessName.trim()
      : null;
  return { businessName, ownerName, ownerEmail };
}

function mapBusinessUsage(
  businessId: string,
  data: Record<string, unknown>,
  planNames: Map<string, string>,
  planPriceLabels: Map<string, string>,
  smsNames: Map<string, string>,
  ownerProfiles: Map<string, OwnerProfile>,
): TenantPackageUsageEntry {
  const planRaw = data.plan as
    | { name?: string; priceLabel?: string }
    | null
    | undefined;
  const smsRaw = data.smsPackage as { name?: string } | null | undefined;
  const planId = resolvePlanId(data);
  const smsPackageId = resolveSmsPackageId(data);
  const smsBalance = parseBusinessSmsFields(data);
  const { ownerName, ownerEmail } = resolveOwnerFromData(data, ownerProfiles);
  const tenantName =
    typeof data.businessName === "string" && data.businessName.trim()
      ? data.businessName.trim()
      : "Unnamed tenant";

  return {
    businessId,
    tenantName,
    businessName: tenantName,
    ownerName,
    ownerEmail,
    planId,
    planName:
      (planId ? planNames.get(planId) : null) ??
      (typeof planRaw?.name === "string" && planRaw.name.trim()
        ? planRaw.name.trim()
        : null),
    planPriceLabel:
      (planId ? planPriceLabels.get(planId) : null) ??
      (typeof planRaw?.priceLabel === "string" && planRaw.priceLabel.trim()
        ? planRaw.priceLabel.trim()
        : null),
    smsPackageId,
    smsPackageName:
      (smsPackageId ? smsNames.get(smsPackageId) : null) ??
      (typeof smsRaw?.name === "string" && smsRaw.name.trim()
        ? smsRaw.name.trim()
        : null),
    smsLimit: smsBalance.limit,
    smsUsed: smsBalance.used,
    smsRemaining: smsBalance.remaining,
    smsBundled: data.smsBundleRenewsWithPlan === true,
    billingStatus:
      typeof data.billing_status === "string" ? data.billing_status : null,
    subscriptionPeriodEnd: toMillis(data.subscriptionPeriodEnd),
  };
}

async function mapFulfilledSessionDoc(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  usageByBusinessId: Map<string, TenantPackageUsageEntry>,
  planNames: Map<string, string>,
  planPriceLabels: Map<string, string>,
  smsNames: Map<string, string>,
): Promise<TenantPackagePurchaseEntry> {
  const data = doc.data() ?? {};
  const businessId =
    typeof data.businessId === "string" ? data.businessId.trim() : "";
  const usage = usageByBusinessId.get(businessId);
  const type =
    data.type === "subscription" || data.type === "sms_topup"
      ? data.type
      : "sms_topup";

  let planId =
    typeof data.planId === "string" && data.planId.trim()
      ? data.planId.trim()
      : null;
  let smsPackageId =
    typeof data.smsPackageId === "string" && data.smsPackageId.trim()
      ? data.smsPackageId.trim()
      : null;

  if (type === "subscription" && !planId && usage?.planId) {
    planId = usage.planId;
  }
  if (type === "sms_topup" && !smsPackageId && usage?.smsPackageId) {
    smsPackageId = usage.smsPackageId;
  }

  const storedBusinessName =
    typeof data.businessName === "string" && data.businessName.trim()
      ? data.businessName.trim()
      : null;
  const storedOwnerName =
    typeof data.ownerName === "string" && data.ownerName.trim()
      ? data.ownerName.trim()
      : null;
  const storedOwnerEmail =
    typeof data.ownerEmail === "string" && data.ownerEmail.trim()
      ? data.ownerEmail.trim()
      : null;
  const storedPlanName =
    typeof data.planName === "string" && data.planName.trim()
      ? data.planName.trim()
      : null;
  const storedPlanPriceLabel =
    typeof data.planPriceLabel === "string" && data.planPriceLabel.trim()
      ? data.planPriceLabel.trim()
      : null;
  const storedSmsName =
    typeof data.smsPackageName === "string" && data.smsPackageName.trim()
      ? data.smsPackageName.trim()
      : null;

  return {
    id: doc.id,
    businessId,
    tenantName:
      storedBusinessName ?? usage?.tenantName ?? usage?.businessName ?? "Unknown tenant",
    businessName:
      storedBusinessName ?? usage?.businessName ?? "Unknown tenant",
    ownerName: storedOwnerName ?? usage?.ownerName ?? null,
    ownerEmail: storedOwnerEmail ?? usage?.ownerEmail ?? null,
    type,
    planId,
    planName:
      storedPlanName ??
      (planId ? (planNames.get(planId) ?? null) : null) ??
      (type === "subscription" ? (usage?.planName ?? null) : null),
    planPriceLabel:
      storedPlanPriceLabel ??
      (planId ? (planPriceLabels.get(planId) ?? null) : null) ??
      (type === "subscription" ? (usage?.planPriceLabel ?? null) : null),
    smsPackageId,
    smsPackageName:
      storedSmsName ??
      (smsPackageId ? (smsNames.get(smsPackageId) ?? null) : null) ??
      (type === "sms_topup" ? (usage?.smsPackageName ?? null) : null),
    fulfilledAt: toMillis(data.fulfilledAt),
  };
}

async function listPurchaseLogs(
  usageByBusinessId: Map<string, TenantPackageUsageEntry>,
  planNames: Map<string, string>,
  planPriceLabels: Map<string, string>,
  smsNames: Map<string, string>,
): Promise<TenantPackagePurchaseEntry[]> {
  const snap = await adminDb
    .collection(FULFILLED_SESSIONS)
    .orderBy("fulfilledAt", "desc")
    .limit(200)
    .get()
    .catch(async () => {
      const fallback = await adminDb.collection(FULFILLED_SESSIONS).limit(200).get();
      return fallback;
    });

  const entries: TenantPackagePurchaseEntry[] = await Promise.all(
    snap.docs.map((doc) =>
      mapFulfilledSessionDoc(
        doc,
        usageByBusinessId,
        planNames,
        planPriceLabels,
        smsNames,
      ),
    ),
  );

  return entries.sort(
    (a, b) => (b.fulfilledAt ?? 0) - (a.fulfilledAt ?? 0),
  );
}

/** Super-admin catalog — tenant plan/SMS assignments and Stripe purchase log. */
export async function getTenantPackageUsageCatalog(): Promise<TenantPackageUsageCatalog> {
  const [businessSnap, plans, smsPackages] = await Promise.all([
    adminDb.collection("businesses").get(),
    listSubscriptionPlans({ includeInactive: true, includeHidden: true }),
    listSmsPackages({ includeInactive: true, includeHidden: true }),
  ]);

  const planNames = new Map(plans.map((p) => [p.id, p.name]));
  const planPriceLabels = new Map(plans.map((p) => [p.id, p.priceLabel]));
  const smsNames = new Map(smsPackages.map((p) => [p.id, p.name]));

  const ownerProfiles = await loadOwnerProfiles(businessSnap.docs);

  const usage: TenantPackageUsageEntry[] = businessSnap.docs.map((doc) =>
    mapBusinessUsage(
      doc.id,
      doc.data() ?? {},
      planNames,
      planPriceLabels,
      smsNames,
      ownerProfiles,
    ),
  );

  usage.sort((a, b) => a.businessName.localeCompare(b.businessName));

  const usageByBusinessId = new Map(
    usage.map((row) => [row.businessId, row]),
  );
  const purchases = await listPurchaseLogs(
    usageByBusinessId,
    planNames,
    planPriceLabels,
    smsNames,
  );

  const usageByPlanId: Record<string, TenantPackageUsageEntry[]> = {};
  const usageBySmsPackageId: Record<string, TenantPackageUsageEntry[]> = {};

  for (const row of usage) {
    if (row.planId) {
      usageByPlanId[row.planId] = usageByPlanId[row.planId] ?? [];
      usageByPlanId[row.planId].push(row);
    }
    if (row.smsPackageId) {
      usageBySmsPackageId[row.smsPackageId] =
        usageBySmsPackageId[row.smsPackageId] ?? [];
      usageBySmsPackageId[row.smsPackageId].push(row);
    }
  }

  return { usage, purchases, usageByPlanId, usageBySmsPackageId };
}
