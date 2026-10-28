import { NextResponse } from "next/server";
import { getServiceDoc, listServiceStaff } from "@/lib/callcenter/catalog";
import { callCenterError, requireCallCenterTenant } from "@/lib/callcenter/tenant";
import { isIsoDate } from "@/lib/inspection/types";

export const runtime = "nodejs";

/**
 * GET /api/call-center/services/{serviceId}/staff?date=YYYY-MM-DD
 * Shortlist of active staff who can take the service. With `date`, staff on
 * approved leave or a weekly off day that day are removed.
 */
export async function GET(request: Request, context: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await context.params;
  const auth = await requireCallCenterTenant(request);
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const date = new URL(request.url).searchParams.get("date")?.trim() ?? "";
  if (date && !isIsoDate(date)) return callCenterError(400, "date must be YYYY-MM-DD.");

  const service = await getServiceDoc(serviceId ?? "", auth.businessId);
  if (!service) return callCenterError(404, "Service not found.");
  try {
    const staff = await listServiceStaff(auth.businessId, service, date || undefined);
    return NextResponse.json({
      ok: true,
      service: {
        id: service.id,
        name: typeof service.name === "string" ? service.name : "",
        requiredSkill: typeof service.requiredSkill === "string" ? service.requiredSkill : null,
        defaultDurationMin: typeof service.defaultDurationMin === "number" ? service.defaultDurationMin : null,
      },
      filter: { date: date || null },
      total: staff.length,
      staff,
    });
  } catch (error) {
    console.error("[call-center] GET /services/{id}/staff failed:", error);
    return callCenterError(500, "Could not fetch staff for this service.");
  }
}
