import { NextResponse } from "next/server";
import { listStaff } from "@/lib/callcenter/catalog";
import { callCenterError, requireCallCenterTenant } from "@/lib/callcenter/tenant";

export const runtime = "nodejs";

/**
 * GET /api/call-center/staff?status=
 * Staff (`role: "staff"`) of the business in X-Tenant-Id / ?businessId=, sorted by name.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterTenant(request);
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  try {
    const staff = await listStaff(auth.businessId, { status });
    return NextResponse.json({ ok: true, businessId: auth.businessId, total: staff.length, staff });
  } catch (error) {
    console.error("[call-center] GET /staff failed:", error);
    return callCenterError(500, "Could not fetch staff.");
  }
}
