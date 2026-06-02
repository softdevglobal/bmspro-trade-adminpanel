import { listBusinessBookings } from "@/lib/bookings/server";
import {
  extractBearerToken,
  requireBusinessOwnerFromToken,
} from "@/lib/notifications/auth-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const bookings = await listBusinessBookings(auth.businessId);
  return NextResponse.json({ ok: true, bookings });
}
