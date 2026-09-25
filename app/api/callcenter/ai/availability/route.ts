/**
 * Command Center AI receptionist — inspection slot availability.
 *
 * GET /api/callcenter/ai/availability?businessId={id}&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Headers: x-command-center-ai-key: <COMMAND_CENTER_AI_SERVICE_KEY>
 *
 * Uses the same team/leave/capacity/closure rules as the booking engine.
 * Search alone reserves nothing — Trade has no slot holds today.
 *
 * Success — 200:
 *   { ok: true, timeZone, available: [{ date, timeRange, startTime, endTime }] }
 */
import { requireCommandCenterAiService } from "@/lib/callcenter/ai-service-auth";
import {
  computeUnavailableSlots,
  timeRangeWindow,
} from "@/lib/booking/slot-availability";
import { adminDb } from "@/lib/firebase/admin";
import { TIME_RANGES } from "@/lib/inspection/types";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_SPAN_DAYS = 21;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const auth = requireCommandCenterAiService(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const businessId = url.searchParams.get("businessId")?.trim() ?? "";
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";

  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "businessId is required." },
      { status: 400 },
    );
  }
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid date range." },
      { status: 400 },
    );
  }
  if (addDaysIso(from, MAX_SPAN_DAYS - 1) < to) {
    return NextResponse.json(
      { ok: false, error: `Date range is limited to ${MAX_SPAN_DAYS} days.` },
      { status: 400 },
    );
  }

  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    if (!snap.exists) {
      return NextResponse.json(
        { ok: false, error: "Business not found." },
        { status: 404 },
      );
    }
    const d = snap.data() ?? {};
    if (!isTenantAccessAllowed(d.status, d.isActive)) {
      return NextResponse.json(
        {
          ok: false,
          error: "This business is not accepting bookings right now.",
          code: "BUSINESS_UNAVAILABLE",
        },
        { status: 403 },
      );
    }
    const timeZone =
      typeof d.timezone === "string" && d.timezone.trim()
        ? d.timezone.trim()
        : PLATFORM_TIME_ZONE;

    const unavailable = await computeUnavailableSlots(
      businessId,
      from,
      to,
      timeZone,
    );
    const blocked = new Set(
      unavailable.map((slot) => `${slot.date}-${slot.timeRange}`),
    );

    const available: Array<{
      date: string;
      timeRange: (typeof TIME_RANGES)[number];
      startTime: string;
      endTime: string;
    }> = [];
    let cursor = from;
    while (cursor <= to) {
      for (const timeRange of TIME_RANGES) {
        if (!blocked.has(`${cursor}-${timeRange}`)) {
          available.push({ date: cursor, timeRange, ...timeRangeWindow(timeRange) });
        }
      }
      cursor = addDaysIso(cursor, 1);
    }

    return NextResponse.json({ ok: true, timeZone, available });
  } catch (error) {
    console.error("[callcenter/ai] GET /availability failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not check availability." },
      { status: 500 },
    );
  }
}
