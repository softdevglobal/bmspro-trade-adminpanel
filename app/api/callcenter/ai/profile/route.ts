/**
 * Command Center AI receptionist — approved business profile + active services.
 *
 * GET /api/callcenter/ai/profile?businessId={id}
 * Headers: x-command-center-ai-key: <COMMAND_CENTER_AI_SERVICE_KEY>
 *
 * Read-only. `businessId` is resolved by Command Center on the server (DID
 * mapping or supervisor selection) — never from caller speech.
 *
 * Success — 200:
 *   { ok: true, profile: { id, businessName, businessType, timeZone,
 *     serviceAreas, state, mainSuburb, workingHours, acceptingBookings },
 *     services: [{ id, name, businessType, requiredSkill, defaultDurationMin }] }
 */
import { requireCommandCenterAiService } from "@/lib/callcenter/ai-service-auth";
import { parseWorkingHoursFromBusiness } from "@/lib/calendar/working-hours";
import { adminDb } from "@/lib/firebase/admin";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { listBusinessServices } from "@/lib/onboarding/services/server";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
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
  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "businessId is required." },
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

    const servicesResult = await listBusinessServices(businessId);
    if (!servicesResult.ok) {
      return NextResponse.json(
        { ok: false, error: "Could not load services." },
        { status: 500 },
      );
    }

    const services = servicesResult.services
      .filter((s) => s.isActive && s.name.trim())
      .map((s) => ({
        id: s.id,
        name: s.name,
        businessType: s.businessType,
        requiredSkill: s.requiredSkill,
        defaultDurationMin: s.defaultDurationMin,
      }));

    return NextResponse.json({
      ok: true,
      profile: {
        id: snap.id,
        businessName: typeof d.businessName === "string" ? d.businessName : "",
        businessType: typeof d.businessType === "string" ? d.businessType : "",
        timeZone:
          typeof d.timezone === "string" && d.timezone.trim()
            ? d.timezone.trim()
            : PLATFORM_TIME_ZONE,
        serviceAreas: stringList(d.serviceAreas),
        state: typeof d.state === "string" ? d.state : "",
        mainSuburb: typeof d.mainSuburb === "string" ? d.mainSuburb : "",
        workingHours: parseWorkingHoursFromBusiness(d),
        acceptingBookings: isTenantAccessAllowed(d.status, d.isActive),
      },
      services,
    });
  } catch (error) {
    console.error("[callcenter/ai] GET /profile failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not load business profile." },
      { status: 500 },
    );
  }
}
