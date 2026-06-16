import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  businessRecordQuotationCustomerDecision,
  cancelQuotation,
  getBusinessQuotationById,
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
    let businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    let role = typeof decoded.role === "string" ? decoded.role : null;

    if (!businessId || !role) {
      const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
      if (userSnap.exists) {
        const data = userSnap.data() ?? {};
        if (!businessId && typeof data.businessId === "string") {
          businessId = data.businessId;
        }
        if (!role && typeof data.role === "string") {
          role = data.role;
        }
      }
    }

    if (role === "business_owner") role = "owner";

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

    if (role === "staff") {
      const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
      const canCreateQuotation =
        userSnap.exists && userSnap.data()?.canget_qutaion === true;
      if (!canCreateQuotation) {
        return {
          ok: false as const,
          status: 403,
          error: "You do not have permission to update this quotation.",
        };
      }
    }

    return {
      ok: true as const,
      uid: decoded.uid,
      role,
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

async function assertStaffOwnsQuotation(
  auth: { role: string; uid: string; businessId: string },
  quotationId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (auth.role !== "staff") return { ok: true };

  const quotation = await getBusinessQuotationById(auth.businessId, quotationId);
  if (!quotation || quotation.createdBy !== auth.uid) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  return { ok: true };
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

  const ownership = await assertStaffOwnsQuotation(auth, id);
  if (!ownership.ok) {
    return NextResponse.json(
      { ok: false, error: ownership.error },
      { status: ownership.status },
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
      ...(typeof payload.serviceDescription === "string"
        ? { serviceDescription: payload.serviceDescription }
        : payload.serviceDescription === null
          ? { serviceDescription: null }
          : {}),
      ...(payload.requestType === "existing_service" ||
      payload.requestType === "custom_quote"
        ? { requestType: payload.requestType }
        : {}),
      ...(typeof payload.serviceId === "string"
        ? { serviceId: payload.serviceId }
        : {}),
      ...(payload.customRequest &&
      typeof payload.customRequest === "object" &&
      !Array.isArray(payload.customRequest)
        ? {
            customRequest: {
              title:
                typeof (payload.customRequest as { title?: unknown }).title ===
                "string"
                  ? (payload.customRequest as { title: string }).title
                  : "",
              description:
                typeof (payload.customRequest as { description?: unknown })
                  .description === "string"
                  ? (payload.customRequest as { description: string })
                      .description
                  : "",
            },
          }
        : {}),
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
