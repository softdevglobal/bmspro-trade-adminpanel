import { requireSuperAdmin } from "@/lib/onboarding/server";
import { getTenantPackageUsageCatalog } from "@/lib/catalog/tenant-package-usage";
import { listSmsPackages } from "@/lib/sms-packages/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Super admin — tenant SMS assignments and Stripe purchase history. */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const [catalog, packages] = await Promise.all([
    getTenantPackageUsageCatalog(),
    listSmsPackages({ includeInactive: true, includeHidden: true }),
  ]);

  return NextResponse.json({
    ok: true,
    catalog,
    catalogItems: packages.map((pkg) => ({ id: pkg.id, name: pkg.name })),
  });
}
