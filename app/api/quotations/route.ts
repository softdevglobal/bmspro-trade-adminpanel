import {
  logQuotationCreated,
  logQuotationSent,
} from "@/lib/audit/action-logs";
import { adminAuth } from "@/lib/firebase/admin";
import {
  createQuotationForInspection,
  createStandaloneQuotation,
  getBusinessQuotationById,
  listBusinessQuotations,
  listQuotationsForInspection,
} from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireQuotationAuthor(request: Request) {
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
        error: "You do not have permission to create quotations.",
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

type QuotationAuthor = {
  uid: string;
  email: string | null;
  name: string | null;
  role: string | null;
  businessId: string;
};

export async function POST(request: Request) {
  const auth = await requireQuotationAuthor(request);
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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;

  // Standalone quotation: no existing request. Creates both a
  // completed requests record and the quotation document.
  if (payload.standalone === true || payload.source === "standalone") {
    const customer = (payload.customer ?? {}) as {
      fullName?: string;
      email?: string;
      phone?: string;
    };
    const address = (payload.address ?? {}) as {
      street?: string;
      suburb?: string;
      state?: string;
      postcode?: string;
    };
    const send = payload.send === true;
    const result = await createStandaloneQuotation(auth.businessId, auth.uid, {
      customer: {
        fullName: typeof customer.fullName === "string" ? customer.fullName : "",
        email: typeof customer.email === "string" ? customer.email : "",
        phone: typeof customer.phone === "string" ? customer.phone : "",
      },
      address: {
        street: typeof address.street === "string" ? address.street : "",
        suburb: typeof address.suburb === "string" ? address.suburb : "",
        state: typeof address.state === "string" ? address.state : "",
        postcode: typeof address.postcode === "string" ? address.postcode : "",
      },
      title: typeof payload.title === "string" ? payload.title : "",
      description:
        typeof payload.description === "string" ? payload.description : null,
      requestType:
        payload.requestType === "existing_service" ||
        payload.requestType === "custom_quote"
          ? payload.requestType
          : undefined,
      serviceId:
        typeof payload.serviceId === "string" ? payload.serviceId : null,
      customRequest:
        payload.customRequest &&
        typeof payload.customRequest === "object" &&
        !Array.isArray(payload.customRequest)
          ? {
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
            }
          : null,
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
      send,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    await logQuotationCreated(auth, result.quotation, "standalone");
    if (send) {
      await logQuotationSent(auth, result.quotation, "standalone");
    }
    return NextResponse.json(
      { ok: true, quotation: result.quotation },
      { status: 201 },
    );
  }

  const inspectionRequestId =
    (typeof payload.requestId === "string" ? payload.requestId : "") ||
    (typeof payload.inspectionRequestId === "string"
      ? payload.inspectionRequestId
      : "");
  const lineItems = payload.lineItems;
  const finalPriceAud =
    typeof payload.finalPriceAud === "number" &&
    Number.isFinite(payload.finalPriceAud)
      ? payload.finalPriceAud
      : null;
  const notes = typeof payload.notes === "string" ? payload.notes : null;
  const termsAndConditions =
    typeof payload.termsAndConditions === "string"
      ? payload.termsAndConditions
      : null;
  const discountAud =
    typeof payload.discountAud === "number" &&
    Number.isFinite(payload.discountAud)
      ? payload.discountAud
      : null;
  const validUntil =
    typeof payload.validUntil === "string" ? payload.validUntil : null;
  const imageUrls = payload.imageUrls;
  const depositRequest = payload.depositRequest ?? null;

  const customerPayload = payload.customer;
  const addressPayload = payload.address;
  const send = payload.send === true;

  const result = await createQuotationForInspection(
    auth.businessId,
    auth.uid,
    {
      inspectionRequestId,
      ...(typeof payload.serviceDescription === "string"
        ? { serviceDescription: payload.serviceDescription }
        : payload.serviceDescription === null
          ? { serviceDescription: null }
          : {}),
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      finalPriceAud,
      notes,
      termsAndConditions,
      discountAud,
      validUntil,
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      depositRequest,
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
      send,
    },
    auth.role,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  await logQuotationCreated(auth, result.quotation, "from_inspection");
  if (send) {
    await logQuotationSent(auth, result.quotation, "from_inspection");
  }

  return NextResponse.json({ ok: true, quotation: result.quotation });
}

/** Lists quotations for a request (admin viewing). */
export async function GET(request: Request) {
  const auth = await requireQuotationAuthor(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const quotationId = url.searchParams.get("quotationId")?.trim() ?? "";
  if (quotationId) {
    const quotation = await getBusinessQuotationById(
      auth.businessId,
      quotationId,
    );
    if (!quotation) {
      return NextResponse.json(
        { ok: false, error: "Quotation not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, quotation });
  }

  const inspectionRequestId =
    url.searchParams.get("requestId")?.trim() ||
    url.searchParams.get("inspectionRequestId")?.trim() ||
    "";

  if (!inspectionRequestId) {
    const quotations = await listBusinessQuotations(auth.businessId);
    return NextResponse.json({ ok: true, quotations });
  }

  const quotations = await listQuotationsForInspection(
    auth.businessId,
    inspectionRequestId,
  );

  return NextResponse.json({ ok: true, quotations });
}
