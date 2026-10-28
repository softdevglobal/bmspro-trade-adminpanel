import { handleBookingStatusRoute, type BookingRouteContext } from "@/lib/callcenter/booking-routes";

export const runtime = "nodejs";

/**
 * POST /api/call-center/bookings/{id}/confirm
 * Schedules the visit. Body: `{ date?, startTime, endTime?, durationMinutes?, timeRange?, staffId?, note? }`.
 * `date` defaults to the customer's first preferred day; `endTime` to start + durationMinutes (60).
 */
export async function POST(request: Request, context: BookingRouteContext) {
  return handleBookingStatusRoute(request, context, "confirm");
}
