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
      email: decoded.email,
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
  const auth = await requireBusinessOwner(request);
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

  const parsed = parseInspectionRequestInput(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  // Auto-create (or reuse) a customer account so they receive the inspection
  // updates and can sign in with the default password.
  let customerId: string | null = null;
  try {
    const businessSnap = await adminDb
      .collection("businesses")
      .doc(auth.businessId)
      .get();
    const businessData = businessSnap.data() ?? {};
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
  } catch (error) {
    console.error("[inspection] customer account creation failed:", error);
  }

  const result = await createInspectionRequest(auth.businessId, parsed.value, {
    customerId,
    createdSource: resolveOwnerCreatedSource(request),
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, requestId: result.request.id, request: result.request },
    { status: 201 },
  );
}
