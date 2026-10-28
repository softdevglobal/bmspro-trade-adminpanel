import { NextResponse } from "next/server";
import { handleBookingStatusRoute, type BookingRouteContext } from "@/lib/callcenter/booking-routes";
import { findBookingForBusiness, serializeBooking } from "@/lib/callcenter/bookings";
import { callCenterError, requireCallCenterTenant } from "@/lib/callcenter/tenant";

export const runtime = "nodejs";

/**
 * GET /api/call-center/bookings/{id}
 * `{id}` = request document id or request code (e.g. `INS-REQ 4K7H2M9P`, URL-encoded).
 * Returns the booking plus the call-center action history.
 */
export async function GET(request: Request, context: BookingRouteContext) {
  const { id } = await context.params;
  const auth = await requireCallCenterTenant(request);
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const found = await findBookingForBusiness(id ?? "", auth.businessId);
  if (!found.ok) return callCenterError(found.status, found.error);
  const raw = found.snap.data() ?? {};
  const actions = Array.isArray(raw.callCenterActions)
    ? raw.callCenterActions.map((entry: Record<string, unknown>) => ({
        ...entry,
        at: entry.at && typeof entry.at === "object" && "toMillis" in entry.at
          ? (entry.at as { toMillis: () => number }).toMillis()
          : null,
      }))
    : [];
  return NextResponse.json(
    { ok: true, booking: serializeBooking(found.booking), callCenterActions: actions },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * PATCH / PUT /api/call-center/bookings/{id}
 * Body: `{ "status": "scheduled" | "cancelled" | "completed", ...confirm/cancel fields }`.
 * Pink spellings `Confirmed` / `Canceled` / `Completed` are accepted too.
 */
export async function PATCH(request: Request, context: BookingRouteContext) {
  return handleBookingStatusRoute(request, context);
}

export async function PUT(request: Request, context: BookingRouteContext) {
  return handleBookingStatusRoute(request, context);
}
