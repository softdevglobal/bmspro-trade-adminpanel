import { handleNotificationTrackingRoute } from "@/lib/callcenter/notification-tracking-route";

export const runtime = "nodejs";

/**
 * POST /api/call-center/customer-notifications/{notificationId}/called-customer
 * Body (optional): `{ "calledCustomer": true | false }` — missing means true.
 */
export async function POST(request: Request, context: { params: Promise<{ notificationId: string }> }) {
  return handleNotificationTrackingRoute(request, context, "called-customer");
}
