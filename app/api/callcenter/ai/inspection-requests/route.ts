/**
 * Command Center AI receptionist — idempotent inspection/quote request commit.
 *
 * POST /api/callcenter/ai/inspection-requests
 * Headers: x-command-center-ai-key: <COMMAND_CENTER_AI_SERVICE_KEY>
 * Body:
 *   { businessId, requestId,            // requestId = Command Center action id (idempotency key)
 *     requestType: "existing_service" | "custom_quote",
 *     serviceId?, customRequest?: { title, description },
 *     customer: { fullName, email, phone },
 *     address: { street, suburb, state, postcode },
 *     preferredSlots: [{ date, timeRange: "morning" | "afternoon" }],
 *     customerNotes? }
 *
 * Re-sending the same requestId returns the original request (`alreadyExisted`)
 * instead of writing a duplicate — safe to retry after a lost response.
 *
 * GET /api/callcenter/ai/inspection-requests?businessId={id}&requestId={id}
 *   Read-back / reconciliation. 404 when the request was never written.
 */
import { logAuditEvent } from "@/lib/audit/server";
import { requireCommandCenterAiService } from "@/lib/callcenter/ai-service-auth";
import { validatePreferredSlotsAvailable } from "@/lib/booking/slot-availability";
import { adminDb } from "@/lib/firebase/admin";
import { getRequestDocument } from "@/lib/inspection/request-document";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { createInspectionRequest } from "@/lib/inspection/server";
import { parseInspectionRequestInput } from "@/lib/inspection/types";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const REQUEST_ID_PATTERN = /^ccai_[A-Za-z0-9_-]{8,80}$/;

function summarize(request: ReturnType<typeof mapInspectionDoc>) {
  return {
    id: request.id,
    requestCode: request.requestCode ?? null,
    status: request.status,
    serviceName: request.serviceName ?? null,
    customRequest: request.customRequest ?? null,
    preferredSlots: request.preferredSlots,
    address: request.address,
    createdSource: request.createdSource,
  };
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
  const requestId = url.searchParams.get("requestId")?.trim() ?? "";
  if (!businessId || !REQUEST_ID_PATTERN.test(requestId)) {
    return NextResponse.json(
      { ok: false, error: "businessId and a valid requestId are required." },
      { status: 400 },
    );
  }

  const snap = await getRequestDocument(requestId);
  if (!snap?.exists || snap.data()?.businessId !== businessId) {
    return NextResponse.json(
      { ok: false, error: "Request not found.", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    request: summarize(mapInspectionDoc(snap.id, snap.data() ?? {})),
  });
}

export async function POST(request: Request) {
  const auth = requireCommandCenterAiService(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: Record<string, unknown>;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!businessId || !REQUEST_ID_PATTERN.test(requestId)) {
    return NextResponse.json(
      { ok: false, error: "businessId and a valid requestId are required." },
      { status: 400 },
    );
  }

  const businessSnap = await adminDb.collection("businesses").doc(businessId).get();
  if (!businessSnap.exists) {
    return NextResponse.json(
      { ok: false, error: "Business not found." },
      { status: 404 },
    );
  }
  const business = businessSnap.data() ?? {};
  if (!isTenantAccessAllowed(business.status, business.isActive)) {
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
    typeof business.timezone === "string" && business.timezone.trim()
      ? business.timezone.trim()
      : PLATFORM_TIME_ZONE;

  // A retry of an already-committed request must not be re-validated against
  // availability (its own slot now counts as busy) — return it as-is.
  const existing = await getRequestDocument(requestId);
  if (existing?.exists) {
    if (existing.data()?.businessId !== businessId) {
      return NextResponse.json(
        { ok: false, error: "Request id is already in use." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      alreadyExisted: true,
      request: summarize(mapInspectionDoc(existing.id, existing.data() ?? {})),
    });
  }

  const parsed = parseInspectionRequestInput(body, timeZone);
  if (!parsed.ok) {
    return NextResponse.json({ ...parsed, code: "VALIDATION" }, { status: 400 });
  }

  const slotCheck = await validatePreferredSlotsAvailable(
    businessId,
    parsed.value.preferredSlots,
    timeZone,
  );
  if (!slotCheck.ok) {
    return NextResponse.json(
      { ...slotCheck, code: "SLOT_CONFLICT" },
      { status: 409 },
    );
  }

  const result = await createInspectionRequest(businessId, parsed.value, {
    customerId: null,
    createdSource: "command_center_ai",
    requestId,
  });
  if (!result.ok) {
    return NextResponse.json({ ...result, code: "VALIDATION" }, { status: 400 });
  }

  if (!result.alreadyExisted) {
    await logAuditEvent({
      businessId,
      category: "inspection",
      action: "inspection.created",
      actor: {
        uid: null,
        role: "call_center",
        name: "Command Center AI receptionist",
        email: null,
      },
      source: "system",
      summary: `Inspection ${result.request.requestCode ?? result.request.id} requested by phone through the Command Center AI receptionist`,
      targetId: result.request.id,
      targetLabel:
        result.request.serviceName ||
        result.request.customRequest?.title ||
        result.request.customer.fullName ||
        null,
      metadata: {
        requestCode: result.request.requestCode ?? null,
        status: result.request.status,
        createdSource: "command_center_ai",
        customerName: result.request.customer.fullName,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    alreadyExisted: Boolean(result.alreadyExisted),
    request: summarize(result.request),
  });
}
