import { NextResponse } from "next/server";
import { requireBookingBusiness } from "@/lib/callcenter/booking-access";
import { computeUnavailableSlots } from "@/lib/booking/slot-availability";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const auth = await requireBookingBusiness(request, query.get("businessId"));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!validDate(from) || !validDate(to) || span < 0 || span >= 90) {
    return NextResponse.json({ ok: false, error: "Choose a valid date range of 1 to 90 days." }, { status: 400 });
  }
  const unavailable = await computeUnavailableSlots(auth.businessId, from, to, auth.timeZone);
  return NextResponse.json({ ok: true, unavailable }, { headers: { "Cache-Control": "no-store" } });
}
