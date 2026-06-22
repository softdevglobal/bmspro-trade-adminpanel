import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  createDirectInvoice,
  createInvoiceFromQuotation,
  getBusinessInvoiceByQuotationId,
  listBusinessInvoices,
  markBusinessInvoicePaid,
} from "@/lib/invoices/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireInvoiceAuthor(request: Request) {
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
    let name = typeof decoded.name === "string" ? decoded.name : null;

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
        if (!name && typeof data.fullName === "string") {
          name = data.fullName;
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
        error: "You do not have permission to create invoices.",
      };
    }

    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email ?? null,
      name,
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

export async function GET(request: Request) {
  const auth = await requireInvoiceAuthor(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const url = new URL(request.url);
    const invoiceId =
      url.searchParams.get("invoiceId")?.trim() ||
      url.searchParams.get("quotationId")?.trim() ||
      "";
    if (invoiceId) {
      const invoice = await getBusinessInvoiceByQuotationId(
        auth.businessId,
        invoiceId,
      );
      if (!invoice) {
        return NextResponse.json(
          { ok: false, error: "Invoice not found." },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, invoice });
    }

    const invoices = await listBusinessInvoices(auth.businessId);
    return NextResponse.json({ ok: true, invoices });
  } catch (error) {
    console.error("[invoices] list failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not load invoices." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireInvoiceAuthor(request);
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
  const quotationId =
    typeof payload.quotationId === "string" ? payload.quotationId.trim() : "";
  const direct = payload.direct === true;
  const invoiceDate =
    typeof payload.invoiceDate === "string" ? payload.invoiceDate.trim() : "";
  const dueDate =
    typeof payload.dueDate === "string" ? payload.dueDate.trim() : "";
  const customerPayload =
    payload.customer && typeof payload.customer === "object"
      ? (payload.customer as Record<string, unknown>)
      : null;
  const addressPayload =
    payload.address && typeof payload.address === "object"
      ? (payload.address as Record<string, unknown>)
      : null;

  if (!quotationId && !direct) {
    return NextResponse.json(
      { ok: false, error: "Quotation is required." },
      { status: 400 },
    );
  }
  if (!invoiceDate || !dueDate) {
    return NextResponse.json(
      { ok: false, error: "Invoice date and due date are required." },
      { status: 400 },
    );
  }

  const sharedInput = {
    lineItems: Array.isArray(payload.lineItems) ? payload.lineItems : [],
    finalPriceAud:
      typeof payload.finalPriceAud === "number" &&
      Number.isFinite(payload.finalPriceAud)
        ? payload.finalPriceAud
        : 0,
    discountAud:
      typeof payload.discountAud === "number" &&
      Number.isFinite(payload.discountAud)
        ? payload.discountAud
        : null,
    gstAud:
      typeof payload.gstAud === "number" && Number.isFinite(payload.gstAud)
        ? payload.gstAud
        : null,
    customer: customerPayload
      ? {
          fullName:
            typeof customerPayload.fullName === "string"
              ? customerPayload.fullName
              : "",
          email:
            typeof customerPayload.email === "string" ? customerPayload.email : "",
          phone:
            typeof customerPayload.phone === "string" ? customerPayload.phone : "",
        }
      : undefined,
    address: addressPayload
      ? {
          street:
            typeof addressPayload.street === "string" ? addressPayload.street : "",
          suburb:
            typeof addressPayload.suburb === "string" ? addressPayload.suburb : "",
          state:
            typeof addressPayload.state === "string" ? addressPayload.state : "",
          postcode:
            typeof addressPayload.postcode === "string"
              ? addressPayload.postcode
              : "",
        }
      : undefined,
    serviceTitle:
      typeof payload.serviceTitle === "string" ? payload.serviceTitle : undefined,
    depositRequest: payload.depositRequest ?? null,
    notes: typeof payload.notes === "string" ? payload.notes : null,
    termsAndConditions:
      typeof payload.termsAndConditions === "string"
        ? payload.termsAndConditions
        : null,
    invoiceDate,
    dueDate,
    send: payload.send === true,
  };

  const result = direct
    ? await (async () => {
        const customer = (payload.customer ?? {}) as Record<string, unknown>;
        const address = (payload.address ?? {}) as Record<string, unknown>;
        return createDirectInvoice(auth.businessId, auth.uid, {
          ...sharedInput,
          customer: {
            fullName:
              typeof customer.fullName === "string" ? customer.fullName : "",
            email: typeof customer.email === "string" ? customer.email : "",
            phone: typeof customer.phone === "string" ? customer.phone : "",
          },
          address: {
            street: typeof address.street === "string" ? address.street : "",
            suburb: typeof address.suburb === "string" ? address.suburb : "",
            state: typeof address.state === "string" ? address.state : "",
            postcode:
              typeof address.postcode === "string" ? address.postcode : "",
          },
          serviceTitle:
            typeof payload.serviceTitle === "string"
              ? payload.serviceTitle
              : "",
          description:
            typeof payload.description === "string"
              ? payload.description
              : null,
          requestType:
            payload.requestType === "existing_service"
              ? "existing_service"
              : payload.requestType === "custom_quote"
                ? "custom_quote"
                : undefined,
          serviceId:
            typeof payload.serviceId === "string" ? payload.serviceId : null,
          customRequest: (() => {
            const raw = payload.customRequest;
            if (!raw || typeof raw !== "object") return null;
            const cr = raw as Record<string, unknown>;
            const title =
              typeof cr.title === "string" ? cr.title.trim() : "";
            const desc =
              typeof cr.description === "string" ? cr.description.trim() : "";
            if (!title) return null;
            return { title, description: desc };
          })(),
        });
      })()
    : await createInvoiceFromQuotation(
        auth.businessId,
        {
          uid: auth.uid,
          email: auth.email,
          role: auth.role,
        },
        {
          quotationId,
          ...sharedInput,
        },
      );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, invoice: result.invoice }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireInvoiceAuthor(request);
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
  const action = typeof payload.action === "string" ? payload.action : "";
  const invoiceId =
    typeof payload.invoiceId === "string"
      ? payload.invoiceId.trim()
      : typeof payload.quotationId === "string"
        ? payload.quotationId.trim()
        : "";

  if (action !== "mark_paid") {
    return NextResponse.json(
      { ok: false, error: "Unsupported invoice action." },
      { status: 400 },
    );
  }

  const result = await markBusinessInvoicePaid(auth.businessId, invoiceId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, invoice: result.invoice });
}
