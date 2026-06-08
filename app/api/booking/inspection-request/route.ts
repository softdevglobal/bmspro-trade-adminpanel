import { logAuditEvent } from "@/lib/audit/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { createInspectionRequest } from "@/lib/inspection/server";
import { parseInspectionRequestInput } from "@/lib/inspection/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function readCustomer(
  request: Request,
): Promise<{ uid: string | null; email: string | null; name: string | null }> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return { uid: null, email: null, name: null };
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return {
      uid: decoded.uid ?? null,
      email: decoded.email ?? null,
      name: typeof decoded.name === "string" ? decoded.name : null,
    };
  } catch {
    return { uid: null, email: null, name: null };
  }
}

async function resolveBusinessIdFromSlug(slug: string): Promise<string | null> {
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const slug =
    body && typeof body === "object" && "slug" in body
      ? String((body as Record<string, unknown>).slug ?? "").trim()
      : "";
  if (!slug) {
    return NextResponse.json(
      { ok: false, error: "Booking link is invalid." },
      { status: 400 },
    );
  }

  const parsed = parseInspectionRequestInput(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const businessId = await resolveBusinessIdFromSlug(slug);
  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "Business not found." },
      { status: 404 },
    );
  }

  const customer = await readCustomer(request);

  const result = await createInspectionRequest(businessId, parsed.value, {
    customerId: customer.uid,
    createdSource: "booking_engine",
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  await logAuditEvent({
    businessId,
    category: "inspection",
    action: "inspection.created",
    actor: {
      uid: customer.uid,
      role: "customer",
      name: customer.name ?? parsed.value.customer.fullName ?? null,
      email: customer.email ?? parsed.value.customer.email ?? null,
    },
    source: "booking_engine",
    summary: `Inspection ${result.request.requestCode ?? result.request.id} requested through the customer booking portal`,
    targetId: result.request.id,
    targetLabel:
      result.request.serviceName ||
      result.request.customRequest?.title ||
      result.request.customer.fullName ||
      null,
    metadata: {
      requestCode: result.request.requestCode ?? null,
      status: result.request.status,
      createdSource: "booking_engine",
      customerName: result.request.customer.fullName,
    },
  });

  return NextResponse.json({ ok: true, requestId: result.request.id });
}
