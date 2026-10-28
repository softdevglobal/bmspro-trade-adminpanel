import { NextResponse } from "next/server";
import { getServiceDoc, listServiceStaff } from "@/lib/callcenter/catalog";
import { callCenterError, requireCallCenterTenant } from "@/lib/callcenter/tenant";
import { getBusinessService } from "@/lib/onboarding/services/server";

export const runtime = "nodejs";

/**
 * GET /api/call-center/services/{serviceId}
 * One service of the business plus the staff who can take it.
 */
export async function GET(request: Request, context: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await context.params;
  const auth = await requireCallCenterTenant(request);
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const raw = await getServiceDoc(serviceId ?? "", auth.businessId);
  if (!raw) return callCenterError(404, "Service not found.");
  const result = await getBusinessService(serviceId, auth.businessId);
  if (!result.ok) return callCenterError(404, "Service not found.");
  const staff = await listServiceStaff(auth.businessId, raw);
  return NextResponse.json({ ok: true, service: { ...result.service, staff } });
}
