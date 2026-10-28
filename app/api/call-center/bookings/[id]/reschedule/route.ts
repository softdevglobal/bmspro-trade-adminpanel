import { handleBookingRescheduleRoute, type BookingRouteContext } from "@/lib/callcenter/booking-routes";

export const runtime = "nodejs";

/**
 * PATCH /api/call-center/bookings/{id}/reschedule
 * Body: `{ newDate, newTime, newEndTime?, timeRange?, reason?, newStaffId? }`.
 * The visit keeps its current length unless `newEndTime` is given.
 */
export async function PATCH(request: Request, context: BookingRouteContext) {
  return handleBookingRescheduleRoute(request, context);
}
