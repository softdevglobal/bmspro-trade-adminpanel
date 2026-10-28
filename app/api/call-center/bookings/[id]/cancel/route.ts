import { handleBookingStatusRoute, type BookingRouteContext } from "@/lib/callcenter/booking-routes";

export const runtime = "nodejs";

/**
 * POST /api/call-center/bookings/{id}/cancel
 * Cancels the request. Body (optional): `{ "reason": "Customer no longer needs it" }`.
 */
export async function POST(request: Request, context: BookingRouteContext) {
  return handleBookingStatusRoute(request, context, "cancel");
}
