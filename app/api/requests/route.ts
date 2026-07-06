import { logAuditEvent } from "@/lib/audit/server";
import { resolveOwnerCreatedSchedule } from "@/lib/calendar/schedule-input";
import { parseWorkingHoursFromBusiness } from "@/lib/calendar/working-hours";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { ensureCustomerAccount } from "@/lib/customer/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  createInspectionRequest,
  listInspectionRequests,
} from "@/lib/inspection/server";
import {
  isCreatedSource,
  parseInspectionRequestInput,
  type InspectionRequestCreatedSource,
} from "@/lib/inspection/types";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function resolveOwnerCreatedSource(
  request: Request,
): InspectionRequestCreatedSource {
  const header = request.headers.get("x-inspection-created-source")?.trim();
  return isCreatedSource(header) && header === "owner_mobile"
    ? "owner_mobile"
    : "owner_dashboard";
}

async function requireBusinessOwner(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing authorization header.",
    };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (!businessId || (role !== "owner" && role !== "admin")) {
      return {
        ok: false as const,
        status: 403,
        error: "Business owner access required.",
      };
    }
    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: typeof decoded.name === "string" ? decoded.name : null,
      role: typeof role === "string" ? role : null,
      businessId,
    };
  } catch {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid or expired session.",
    };
  }
}

export async function GET(request: Request) {
  // Read access is granted to any business member (owner, admin, staff) so
  // that staff who can create quotations can pull existing customers for the
  // customer autocomplete. Creating requests (POST) remains owner-only.
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const requests = await listInspectionRequests(auth.businessId);
  return NextResponse.json({ ok: true, requests });
}

/** Owner-authenticated create (mobile app / dashboard walk-in). */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const businessSnap = await adminDb
    .collection("businesses")
    .doc(auth.businessId)
    .get();
  const businessData = businessSnap.data() ?? {};
  const timeZone =
    typeof businessData.timezone === "string" && businessData.timezone.trim()
      ? businessData.timezone.trim()
      : PLATFORM_TIME_ZONE;

  const parsed = parseInspectionRequestInput(body, timeZone);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  // Auto-create (or reuse) a customer account so they receive the inspection
  // updates and can sign in with the default password.
  let customerId: string | null = null;
  let customerCreated = false;
  try {
    const account = await ensureCustomerAccount({
      email: parsed.value.customer.email,
      fullName: parsed.value.customer.fullName,
      phone: parsed.value.customer.phone,
      businessId: auth.businessId,
      businessName:
        typeof businessData.businessName === "string"
          ? businessData.businessName
          : null,
      bookingSlug:
        typeof businessData.bookingSlug === "string"
          ? businessData.bookingSlug
          : null,
      logoUrl:
        typeof businessData.logoUrl === "string" ? businessData.logoUrl : null,
      context: "inspection",
    });
    customerId = account.uid;
    customerCreated = account.created;
  } catch (error) {
    console.error("[inspection] customer account creation failed:", error);
  }

  const createdSource = resolveOwnerCreatedSource(request);
  const workingHours = parseWorkingHoursFromBusiness(businessData);
  // Owner-created requests confirm the visit immediately (no customer review step).
  const calendarSchedule = resolveOwnerCreatedSchedule(
    body as Record<string, unknown>,
    parsed.value.preferredSlots,
    workingHours,
  );
  const result = await createInspectionRequest(auth.businessId, parsed.value, {
    customerId,
    createdSource,
    scheduleOnCreate: calendarSchedule ?? undefined,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  const actor = {
    uid: auth.uid,
    role: actorRoleFromClaim(auth.role),
    name: auth.name,
    email: auth.email,
  };
  const source = createdSource === "owner_mobile" ? "mobile_app" : "admin_panel";

  if (customerCreated) {
    await logAuditEvent({
      businessId: auth.businessId,
      category: "customer",
      action: "customer.created",
      actor,
      source,
      summary: `New customer ${parsed.value.customer.fullName || parsed.value.customer.email} added while booking an inspection`,
      targetId: customerId,
      targetLabel:
        parsed.value.customer.fullName || parsed.value.customer.email,
      metadata: { via: "inspection" },
    });
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "inspection",
    action: "inspection.created",
    actor,
    source,
    summary: `Inspection ${result.request.requestCode ?? result.request.id} created via the admin panel`,
    targetId: result.request.id,
    targetLabel:
      result.request.serviceName ||
      result.request.customRequest?.title ||
      result.request.customer.fullName ||
      null,
    metadata: {
      requestCode: result.request.requestCode ?? null,
      status: result.request.status,
      createdSource,
      customerName: result.request.customer.fullName,
    },
  });

  return NextResponse.json(
    { ok: true, requestId: result.request.id, request: result.request },
    { status: 201 },
  );
}
