import { adminDb } from "@/lib/firebase/admin";
import type { TenantDetail } from "@/lib/onboarding/tenant-display";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
    timezone: data.timezone ?? null,
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

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const snapshot = await adminDb
    .collection("businesses")
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  const tenants = snapshot.docs.map(mapTenantDoc);

  return NextResponse.json({ ok: true, tenants });
}
