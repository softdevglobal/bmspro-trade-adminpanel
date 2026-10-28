import { NextResponse } from "next/server";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { listServices, listStaff, listWorkshops } from "@/lib/callcenter/catalog";
import { agentBusinessIds, callCenterError } from "@/lib/callcenter/tenant";

export const runtime = "nodejs";

/**
 * GET /api/call-center/workshops?summary=1
 * Businesses the caller can work with. Super admin → all; agent → its
 * assigned businesses (`assignedBusinessIds` + `workshopOwnerUid`).
 * Suspended / inactive businesses are left out.
 * Default = full bundle (business + active services + staff); `summary=1` = business only.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const summary = ["1", "true"].includes(new URL(request.url).searchParams.get("summary") ?? "");

  try {
    const workshops = await listWorkshops(
      auth.isSuperAdmin ? { all: true } : { ids: await agentBusinessIds(auth.uid) },
    );
    if (summary) {
      return NextResponse.json({ ok: true, total: workshops.length, workshops });
    }
    const bundles = await Promise.all(
      workshops.map(async (workshop) => {
        const [services, staff] = await Promise.all([
          listServices(workshop.businessId, true),
          listStaff(workshop.businessId),
        ]);
        return { workshop, services, staff };
      }),
    );
    return NextResponse.json({ ok: true, total: bundles.length, workshops: bundles });
  } catch (error) {
    console.error("[call-center] GET /workshops failed:", error);
    return callCenterError(500, "Could not fetch workshops.");
  }
}
