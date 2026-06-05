import { adminAuth } from "@/lib/firebase/admin";
import { createInvoiceFromQuotation } from "@/lib/invoices/server";
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
        error: "You do not have permission to create invoices.",
      };
    }

    return {
      ok: true as const,
      uid: decoded.uid,
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
  const invoiceDate =
    typeof payload.invoiceDate === "string" ? payload.invoiceDate.trim() : "";
  const dueDate =
    typeof payload.dueDate === "string" ? payload.dueDate.trim() : "";

  if (!quotationId) {
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

  const result = await createInvoiceFromQuotation(auth.businessId, auth.uid, {
    quotationId,
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
    depositRequest: payload.depositRequest ?? null,
    notes: typeof payload.notes === "string" ? payload.notes : null,
    termsAndConditions:
      typeof payload.termsAndConditions === "string"
        ? payload.termsAndConditions
        : null,
    invoiceDate,
    dueDate,
    send: payload.send === true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, invoice: result.invoice }, { status: 201 });
}
