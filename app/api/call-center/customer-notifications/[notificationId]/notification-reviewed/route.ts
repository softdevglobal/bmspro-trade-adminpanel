import { handleNotificationTrackingRoute } from "@/lib/callcenter/notification-tracking-route";

export const runtime = "nodejs";

/**
 * POST /api/call-center/customer-notifications/{notificationId}/notification-reviewed
 * Body (optional): `{ "notificationReviewed": true | false }` — missing means true.
 */
export async function POST(request: Request, context: { params: Promise<{ notificationId: string }> }) {
  return handleNotificationTrackingRoute(request, context, "notification-reviewed");
}
