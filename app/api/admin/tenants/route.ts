/**
 * GET /api/admin/tenants — list all businesses (super admin).
 */

import { listAllTenants } from "@/lib/onboarding/tenant-list-server";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const tenants = await listAllTenants();
    return NextResponse.json({ ok: true, tenants });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not load tenants." },
      { status: 500 },
    );
  }
}
