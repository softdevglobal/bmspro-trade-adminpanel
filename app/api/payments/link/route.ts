import { getBusinessInvoiceByQuotationId } from "@/lib/invoices/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { getBusinessQuotationById } from "@/lib/quotations/server";
import { getAppBaseUrl } from "@/lib/stripe/config";
import {
  getOrCreatePaymentLink,
  paymentLinkPath,
} from "@/lib/stripe/payment-links";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Owner/staff endpoint: mints (or reuses) a secure payment link for a doc. */
export async function POST(request: Request) {
  const auth = await requireBusinessMember(request);
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

  const payload = (body ?? {}) as Record<string, unknown>;
  const type =
    payload.type === "quotation" || payload.type === "invoice"
      ? payload.type
      : null;
  const targetId =
    typeof payload.targetId === "string" ? payload.targetId.trim() : "";

  if (!type || !targetId) {
    return NextResponse.json(
      { ok: false, error: "A valid type and target are required." },
      { status: 400 },
    );
  }

  // Ownership check: only mint links for documents in the caller's business.
  if (type === "quotation") {
    const quotation = await getBusinessQuotationById(auth.businessId, targetId);
    if (!quotation) {
      return NextResponse.json(
        { ok: false, error: "Quotation not found." },
        { status: 404 },
      );
    }
  } else {
    const invoice = await getBusinessInvoiceByQuotationId(
      auth.businessId,
      targetId,
    );
    if (!invoice) {
      return NextResponse.json(
        { ok: false, error: "Invoice not found." },
        { status: 404 },
      );
    }
  }

  const link = await getOrCreatePaymentLink({
    type,
    businessId: auth.businessId,
    targetId,
  });
  const path = paymentLinkPath(link);

  return NextResponse.json({
    ok: true,
    token: link.token,
    path,
    url: `${getAppBaseUrl()}${path}`,
  });
}
