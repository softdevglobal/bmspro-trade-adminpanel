import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

function mapTenantDoc(doc: QueryDocumentSnapshot): TenantDetail {
  const data = doc.data();
  const plan = data.plan as
    | {
        name?: string;
        price?: number;
        period?: string;
        trialDays?: number | null;
      }
    | null
    | undefined;

  const owner = data.owner as
    | { fullName?: string; email?: string; firstName?: string; lastName?: string }
    | null
    | undefined;

  const fullName =
    owner?.fullName ||
    [owner?.firstName, owner?.lastName].filter(Boolean).join(" ") ||
    null;

  return {
    id: doc.id,
    businessName: data.businessName ?? "",
    businessEmail: data.businessEmail ?? "",
    businessPhone: data.businessPhone ?? "",
    businessType: data.businessType ?? "",
    abn: data.abn ?? null,
    businessStructure: data.businessStructure ?? null,
    registeredForGst: Boolean(data.registeredForGst),
    businessAddress: data.businessAddress ?? null,
    state: data.state ?? "",
    postcode: data.postcode ?? "",
    timezone: typeof data.timezone === "string" ? data.timezone : PLATFORM_TIME_ZONE,
    mainSuburb: data.mainSuburb ?? "",
    serviceAreas: Array.isArray(data.serviceAreas)
      ? (data.serviceAreas as unknown[])
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter((v): v is string => v.length > 0)
      : [],
    bookingSlug:
      typeof data.bookingSlug === "string" && data.bookingSlug.length > 0
        ? data.bookingSlug
        : null,
    bookingPath:
      typeof data.bookingPath === "string" && data.bookingPath.length > 0
        ? data.bookingPath
        : typeof data.bookingSlug === "string" && data.bookingSlug.length > 0
          ? `/booknow/${data.bookingSlug}`
          : null,
    plan: plan?.name
      ? {
          name: plan.name,
          price: plan.price ?? 0,
          period: plan.period ?? "",
          trialDays: plan.trialDays ?? null,
        }
      : null,
    status: data.status ?? "pending_review",
    source: data.source ?? "self_signup",
    isActive: Boolean(data.isActive),
    onboardingProgress:
      typeof data.onboardingProgress === "number" ? data.onboardingProgress : null,
    onboardingStep: data.onboardingStep ?? null,
    owner: owner
      ? {
          fullName,
          email: owner.email ?? data.businessEmail ?? null,
        }
      : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Super-admin tenant list (newest first). */
export async function listAllTenants(limit = 100): Promise<TenantDetail[]> {
  try {
    const snapshot = await adminDb
      .collection("businesses")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snapshot.docs.map(mapTenantDoc);
  } catch {
    const snapshot = await adminDb.collection("businesses").limit(limit).get();
    return snapshot.docs
      .map(mapTenantDoc)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
}
