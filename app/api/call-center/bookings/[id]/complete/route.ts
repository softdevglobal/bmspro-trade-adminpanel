import { handleBookingStatusRoute, type BookingRouteContext } from "@/lib/callcenter/booking-routes";

export const runtime = "nodejs";

/**
 * POST /api/call-center/bookings/{id}/complete
 * Completes the request. Trade only allows this once a quotation exists, so this usually
 * returns 400 with the business rule message.
 */
export async function POST(request: Request, context: BookingRouteContext) {
  return handleBookingStatusRoute(request, context, "complete");
}
