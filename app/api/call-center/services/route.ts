import { NextResponse } from "next/server";
import { listServices } from "@/lib/callcenter/catalog";
import { callCenterError, requireCallCenterTenant } from "@/lib/callcenter/tenant";

export const runtime = "nodejs";

/**
 * GET /api/call-center/services?activeOnly=false
 * Bookable services of the business (active only by default).
 * Use `services[].id` as `serviceId` in POST /api/call-center/bookings.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterTenant(request);
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const activeOnly = new URL(request.url).searchParams.get("activeOnly") !== "false";
  try {
    const services = await listServices(auth.businessId, activeOnly);
    return NextResponse.json({ ok: true, businessId: auth.businessId, total: services.length, services });
  } catch (error) {
    console.error("[call-center] GET /services failed:", error);
    return callCenterError(500, "Could not fetch services.");
  }
}
