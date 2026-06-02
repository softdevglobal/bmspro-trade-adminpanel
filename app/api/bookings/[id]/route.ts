import { getBusinessBooking } from "@/lib/bookings/server";
import {
  extractBearerToken,
  requireBusinessOwnerFromToken,
} from "@/lib/notifications/auth-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token =
    request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ??
    extractBearerToken(request);
  const auth = await requireBusinessOwnerFromToken(token);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const booking = await getBusinessBooking(auth.businessId, id);
  if (!booking) {
    return NextResponse.json(
      { ok: false, error: "Booking not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, booking });
}
