import { getTenantPackageUsageCatalog } from "@/lib/catalog/tenant-package-usage";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { listSubscriptionPlans } from "@/lib/subscription-plans/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Super admin — tenant subscription assignments and Stripe purchase history. */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const [catalog, plans] = await Promise.all([
    getTenantPackageUsageCatalog(),
    listSubscriptionPlans({ includeInactive: true, includeHidden: true }),
  ]);

  return NextResponse.json({
    ok: true,
    catalog,
    catalogItems: plans.map((plan) => ({ id: plan.id, name: plan.name })),
  });
}
