import "server-only";

import { NextResponse } from "next/server";
import {
  changeBookingStatus,
  rescheduleBooking,
  statusToAction,
  type StatusAction,
} from "@/lib/callcenter/bookings";
import { callCenterError, readJsonObject, requireCallCenterTenant } from "@/lib/callcenter/tenant";

export type BookingRouteContext = { params: Promise<{ id: string }> };

/** Shared by POST …/confirm|cancel|complete and PATCH/PUT …/bookings/{id}. */
export async function handleBookingStatusRoute(
  request: Request,
  context: BookingRouteContext,
  fixedAction?: StatusAction,
): Promise<NextResponse> {
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body) return callCenterError(400, "Invalid JSON body.");
  const auth = await requireCallCenterTenant(request, { body, humanOnly: true });
  if (!auth.ok) return callCenterError(auth.status, auth.error);

  const action = fixedAction ?? statusToAction(typeof body.status === "string" ? body.status : "");
  if (!action) {
    return callCenterError(400, "status must be one of: scheduled (Confirmed), cancelled (Canceled), completed.");
  }
  const result = await changeBookingStatus(auth, id ?? "", action, body);
  if (!result.ok) return callCenterError(result.status, result.error, result.extra);
  return NextResponse.json(result.body);
}

export async function handleBookingRescheduleRoute(
  request: Request,
  context: BookingRouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body) return callCenterError(400, "Invalid JSON body.");
  const auth = await requireCallCenterTenant(request, { body, humanOnly: true });
  if (!auth.ok) return callCenterError(auth.status, auth.error);
  const result = await rescheduleBooking(auth, id ?? "", body);
  if (!result.ok) return callCenterError(result.status, result.error, result.extra);
  return NextResponse.json(result.body);
}
