import { computeUnavailableSlots } from "@/lib/booking/slot-availability";
import { adminDb } from "@/lib/firebase/admin";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function resolveBusinessFromSlug(
  slug: string,
): Promise<{ id: string; timeZone: string } | null> {
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  if (!isTenantAccessAllowed(data.status, data.isActive)) {
    return null;
  }
  return {
    id: doc.id,
    timeZone:
      typeof data.timezone === "string" && data.timezone.trim()
        ? data.timezone.trim()
        : PLATFORM_TIME_ZONE,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim() ?? "";
  const fromDate = url.searchParams.get("from")?.trim() ?? "";
  const toDate = url.searchParams.get("to")?.trim() ?? "";

  if (!slug) {
    return NextResponse.json(
      { ok: false, error: "Booking link is invalid." },
      { status: 400 },
    );
  }

  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid date range." },
      { status: 400 },
    );
  }

  const spanDays =
    Math.round(
      (new Date(`${toDate}T12:00:00`).getTime() -
        new Date(`${fromDate}T12:00:00`).getTime()) /
        86_400_000,
    ) + 1;
  if (spanDays > 90) {
    return NextResponse.json(
      { ok: false, error: "Date range is too large." },
      { status: 400 },
    );
  }

  const business = await resolveBusinessFromSlug(slug);
  if (!business) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This business is not accepting bookings right now. Please contact them directly.",
        code: "BUSINESS_UNAVAILABLE",
      },
      { status: 403 },
    );
  }

  const unavailable = await computeUnavailableSlots(
    business.id,
    fromDate,
    toDate,
    business.timeZone,
  );

  return NextResponse.json({ ok: true, unavailable });
}
