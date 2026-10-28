import { NextResponse } from "next/server";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { listCustomerNotificationsFor } from "@/lib/callcenter/customer-notifications";
import {
  agentBusinessIds,
  callCenterError,
  intParam,
  readTenantId,
  requireCallCenterTenant,
} from "@/lib/callcenter/tenant";

export const runtime = "nodejs";

/**
 * GET /api/call-center/customer-notifications?all=1&unreadOnly=1&limit=50&sinceDays=14
 * With a tenant → that business's customer inbox.
 * `all=1` → agent: every assigned business; super admin: platform-wide.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const flag = (key: string) => ["1", "true"].includes(query.get(key) ?? "");
  const all = flag("all") || query.get("scope") === "all";
  const options = {
    unreadOnly: flag("unreadOnly"),
    limit: intParam(query.get("limit"), 50, 1, 200),
    sinceDays: intParam(query.get("sinceDays"), 14, 1, 90),
  };

  try {
    if (!all) {
      if (!readTenantId(request)) {
        return callCenterError(400, "Missing businessId (X-Tenant-Id header or ?businessId=), or pass all=1.");
      }
      const auth = await requireCallCenterTenant(request, { humanOnly: true });
      if (!auth.ok) return callCenterError(auth.status, auth.error);
      const notifications = await listCustomerNotificationsFor([auth.businessId], options);
      return NextResponse.json({
        ok: true,
        scope: "business",
        businessId: auth.businessId,
        notifications,
        total: notifications.length,
        unreadCount: notifications.filter((n) => !n.read).length,
        ...options,
      });
    }

    const auth = await requireCallCenterAgent(request);
    if (!auth.ok) return callCenterError(auth.status, auth.error);
    const scoped = auth.isSuperAdmin ? null : await agentBusinessIds(auth.uid);
    const notifications = await listCustomerNotificationsFor(scoped ?? "all", options);
    return NextResponse.json({
      ok: true,
      scope: "all",
      scopedToBusinesses: scoped,
      notifications,
      total: notifications.length,
      unreadCount: notifications.filter((n) => !n.read).length,
      ...options,
    });
  } catch (error) {
    console.error("[call-center] GET /customer-notifications failed:", error);
    return callCenterError(500, "Failed to fetch customer notifications.");
  }
}
