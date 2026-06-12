import { adminAuth } from "@/lib/firebase/admin";
import {
  businessRecordQuotationCustomerDecision,
  cancelQuotation,
  undoCancelQuotation,
  updateDraftQuotation,
} from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessAuthor(request: Request) {
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
    if (
      !businessId ||
      (role !== "staff" && role !== "owner" && role !== "admin")
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "You do not have permission to update this quotation.",
      };
    }

    return {
      ok: true as const,
      uid: decoded.uid,
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBusinessAuthor(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";

  if (action === "save_draft") {
    const customerPayload = payload.customer;
    const addressPayload = payload.address;
    const result = await updateDraftQuotation(id, auth.businessId, auth.uid, {
      inspectionRequestId:
        typeof payload.requestId === "string"
          ? payload.requestId
          : typeof payload.inspectionRequestId === "string"
            ? payload.inspectionRequestId
            : "",
      lineItems: Array.isArray(payload.lineItems) ? payload.lineItems : [],
      finalPriceAud:
        typeof payload.finalPriceAud === "number" &&
        Number.isFinite(payload.finalPriceAud)
          ? payload.finalPriceAud
          : null,
      notes: typeof payload.notes === "string" ? payload.notes : null,
      termsAndConditions:
        typeof payload.termsAndConditions === "string"
          ? payload.termsAndConditions
          : null,
      discountAud:
        typeof payload.discountAud === "number" &&
        Number.isFinite(payload.discountAud)
          ? payload.discountAud
          : null,
      validUntil:
        typeof payload.validUntil === "string" ? payload.validUntil : null,
      imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : [],
      depositRequest: payload.depositRequest ?? null,
      ...(customerPayload &&
      typeof customerPayload === "object" &&
      !Array.isArray(customerPayload)
        ? {
            customer: {
              fullName:
                typeof (customerPayload as { fullName?: unknown }).fullName ===
                "string"
                  ? (customerPayload as { fullName: string }).fullName
                  : "",
              email:
                typeof (customerPayload as { email?: unknown }).email ===
                "string"
                  ? (customerPayload as { email: string }).email
                  : "",
              phone:
                typeof (customerPayload as { phone?: unknown }).phone ===
                "string"
                  ? (customerPayload as { phone: string }).phone
                  : "",
            },
          }
        : {}),
      ...(addressPayload &&
      typeof addressPayload === "object" &&
      !Array.isArray(addressPayload)
        ? {
            address: {
              street:
                typeof (addressPayload as { street?: unknown }).street ===
                "string"
                  ? (addressPayload as { street: string }).street
                  : "",
              suburb:
                typeof (addressPayload as { suburb?: unknown }).suburb ===
                "string"
                  ? (addressPayload as { suburb: string }).suburb
                  : "",
              state:
                typeof (addressPayload as { state?: unknown }).state ===
                "string"
                  ? (addressPayload as { state: string }).state
                  : "",
              postcode:
                typeof (addressPayload as { postcode?: unknown }).postcode ===
                "string"
                  ? (addressPayload as { postcode: string }).postcode
                  : "",
            },
          }
        : {}),
      send: payload.send === true,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ ok: true, quotation: result.quotation });
  }

  if (action === "cancel") {
    const result = await cancelQuotation(id, auth.businessId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ ok: true, quotation: result.quotation });
  }

  if (action === "undo_cancel") {
    const result = await undoCancelQuotation(id, auth.businessId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({ ok: true, quotation: result.quotation });
  }

  if (action !== "customer_decision") {
    return NextResponse.json(
      { ok: false, error: "Unsupported action." },
      { status: 400 },
    );
  }

  const decision = payload.decision;
  if (decision !== "accepted" && decision !== "rejected") {
    return NextResponse.json(
      { ok: false, error: "Choose accept or reject." },
      { status: 400 },
    );
  }

  const result = await businessRecordQuotationCustomerDecision(
    id,
    auth.businessId,
    decision,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    decision,
    request: result.request,
  });
}
