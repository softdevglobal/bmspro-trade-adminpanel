import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { completeBookingForInvoicedQuotation } from "@/lib/bookings/server";
import { getBusinessQuotationById } from "@/lib/quotations/server";
import type {
  QuotationDepositRequest,
  QuotationLineItem,
} from "@/lib/quotations/types";
import { formatDepositPaymentNote } from "@/lib/quotations/document";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { buildInvoiceCodeForQuotation } from "@/lib/reference-codes";
import { FieldValue } from "firebase-admin/firestore";
import type { CreateInvoiceInput, InvoiceDetail } from "@/lib/invoices/types";

export const INVOICE_COLLECTION = "invoices";

function parseDepositRequest(raw: unknown): QuotationDepositRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const mode = data.mode === "fixed" ? "fixed" : "percent";
  const amountAud =
    typeof data.amountAud === "number" && Number.isFinite(data.amountAud)
      ? data.amountAud
      : null;
  const dueDate = typeof data.dueDate === "string" ? data.dueDate.trim() : "";
  if (amountAud == null || amountAud <= 0 || !dueDate) return null;
  const percent =
    typeof data.percent === "number" && Number.isFinite(data.percent)
      ? data.percent
      : 0;
  return {
    mode,
    percent: mode === "percent" ? percent : 0,
    amountAud: Math.round(amountAud * 100) / 100,
    dueDate,
  };
}

function mapInvoiceDoc(id: string, data: Record<string, unknown>): InvoiceDetail {
  const lineItemsRaw = Array.isArray(data.lineItems) ? data.lineItems : [];
  const lineItems = lineItemsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const priceAud =
        typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
          ? item.priceAud
          : null;
      if (!name || priceAud == null || priceAud < 0) return null;
      return {
        name,
        priceAud,
        code: typeof item.code === "string" ? item.code : undefined,
        description:
          typeof item.description === "string" ? item.description : undefined,
        quantity:
          typeof item.quantity === "number" && Number.isFinite(item.quantity)
            ? item.quantity
            : undefined,
        rateAud:
          typeof item.rateAud === "number" && Number.isFinite(item.rateAud)
            ? item.rateAud
            : undefined,
        gstPercent:
          typeof item.gstPercent === "number" && Number.isFinite(item.gstPercent)
            ? item.gstPercent
            : undefined,
      } satisfies QuotationLineItem;
    })
    .filter((item) => item !== null) as QuotationLineItem[];

  const customerRaw = data.customer;
  const customer =
    customerRaw && typeof customerRaw === "object"
      ? {
          fullName:
            typeof (customerRaw as Record<string, unknown>).fullName === "string"
              ? ((customerRaw as Record<string, unknown>).fullName as string)
              : "",
          email:
            typeof (customerRaw as Record<string, unknown>).email === "string"
              ? ((customerRaw as Record<string, unknown>).email as string)
              : "",
          phone:
            typeof (customerRaw as Record<string, unknown>).phone === "string"
              ? ((customerRaw as Record<string, unknown>).phone as string)
              : "",
        }
      : { fullName: "", email: "", phone: "" };

  const addressRaw = data.address;
  const address =
    addressRaw && typeof addressRaw === "object"
      ? {
          street:
            typeof (addressRaw as Record<string, unknown>).street === "string"
              ? ((addressRaw as Record<string, unknown>).street as string)
              : "",
          suburb:
            typeof (addressRaw as Record<string, unknown>).suburb === "string"
              ? ((addressRaw as Record<string, unknown>).suburb as string)
              : "",
          state:
            typeof (addressRaw as Record<string, unknown>).state === "string"
              ? ((addressRaw as Record<string, unknown>).state as string)
              : "",
          postcode:
            typeof (addressRaw as Record<string, unknown>).postcode === "string"
              ? ((addressRaw as Record<string, unknown>).postcode as string)
              : "",
        }
      : { street: "", suburb: "", state: "", postcode: "" };

  const toMillis = (value: unknown): number | null => {
    if (value == null) return null;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "object" && value !== null && "toMillis" in value) {
      try {
        return (value as { toMillis: () => number }).toMillis();
      } catch {
        return null;
      }
    }
    return null;
  };

  return {
    id,
    invoiceCode:
      typeof data.invoiceCode === "string" ? data.invoiceCode : "",
    businessId: typeof data.businessId === "string" ? data.businessId : "",
    quotationId: typeof data.quotationId === "string" ? data.quotationId : "",
    quotationCode:
      typeof data.quotationCode === "string" ? data.quotationCode : null,
    inspectionRequestId:
      typeof data.inspectionRequestId === "string"
        ? data.inspectionRequestId
        : "",
    serviceTitle:
      typeof data.serviceTitle === "string" ? data.serviceTitle : "",
    customer,
    address,
    lineItems,
    subtotalAud:
      typeof data.subtotalAud === "number" && Number.isFinite(data.subtotalAud)
        ? data.subtotalAud
        : 0,
    discountAud:
      typeof data.discountAud === "number" && Number.isFinite(data.discountAud)
        ? data.discountAud
        : 0,
    gstAud:
      typeof data.gstAud === "number" && Number.isFinite(data.gstAud)
        ? data.gstAud
        : 0,
    finalPriceAud:
      typeof data.finalPriceAud === "number" &&
      Number.isFinite(data.finalPriceAud)
        ? data.finalPriceAud
        : 0,
    balanceDueAud:
      typeof data.balanceDueAud === "number" &&
      Number.isFinite(data.balanceDueAud)
        ? data.balanceDueAud
        : typeof data.finalPriceAud === "number" &&
            Number.isFinite(data.finalPriceAud)
          ? data.finalPriceAud
          : 0,
    depositRequest: parseDepositRequest(data.depositRequest),
    bookingId: typeof data.bookingId === "string" ? data.bookingId : null,
    bookingCode:
      typeof data.bookingCode === "string" ? data.bookingCode : null,
    notes: typeof data.notes === "string" ? data.notes : null,
    termsAndConditions:
      typeof data.termsAndConditions === "string"
        ? data.termsAndConditions
        : null,
    invoiceDate:
      typeof data.invoiceDate === "string" ? data.invoiceDate : "",
    dueDate: typeof data.dueDate === "string" ? data.dueDate : "",
    status: data.status === "sent" ? "sent" : "draft",
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

export async function createInvoiceFromQuotation(
  businessId: string,
  uid: string,
  input: CreateInvoiceInput,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const quotation = await getBusinessQuotationById(
    businessId,
    input.quotationId.trim(),
  );
  if (!quotation) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  const docRef = adminDb.collection(INVOICE_COLLECTION).doc(quotation.id);
  const existing = await docRef.get();
  if (existing.exists && existing.data()?.businessId === businessId) {
    const existingInvoice = mapInvoiceDoc(
      existing.id,
      existing.data() ?? {},
    );
    if (!input.send) {
      return { ok: true, invoice: existingInvoice };
    }
    if (existingInvoice.status !== "sent") {
      await docRef.update({
        status: "sent",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const sent = await docRef.get();
    const invoice = mapInvoiceDoc(sent.id, sent.data() ?? {});
    await sendInvoiceEmailForDetail(invoice, businessId);
    return { ok: true, invoice };
  }

  const lineItems = input.lineItems.filter(
    (item) => item.name.trim() && item.priceAud >= 0,
  );
  if (lineItems.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Add at least one line item.",
    };
  }

  const subtotalAud = lineItems.reduce((sum, item) => sum + item.priceAud, 0);
  const discountAud = Math.max(0, input.discountAud ?? 0);
  const gstAud = Math.max(0, input.gstAud ?? 0);
  const finalPriceAud = Math.max(0, input.finalPriceAud);

  const depositRequest = parseDepositRequest(input.depositRequest);
  const depositAmount = depositRequest
    ? Math.min(depositRequest.amountAud, finalPriceAud)
    : 0;
  const balanceDueAud =
    Math.round(Math.max(0, finalPriceAud - depositAmount) * 100) / 100;

  const invoiceCode = buildInvoiceCodeForQuotation(quotation);
  const now = FieldValue.serverTimestamp();

  // Mark (or create) the linked booking as completed.
  const booking = await completeBookingForInvoicedQuotation({
    businessId,
    inspectionRequestId: quotation.inspectionRequestId,
    quotation: {
      id: quotation.id,
      quotationCode: quotation.quotationCode,
      serviceTitle: quotation.serviceTitle,
      customer: quotation.customer,
      address: quotation.address,
      finalPriceAud,
      subtotalAud,
      balanceDueAud,
      status: quotation.status,
    },
  });

  await docRef.set({
    invoiceCode,
    businessId,
    quotationId: quotation.id,
    quotationCode: quotation.quotationCode,
    inspectionRequestId: quotation.inspectionRequestId,
    serviceTitle: quotation.serviceTitle,
    customer: quotation.customer,
    address: quotation.address,
    lineItems,
    subtotalAud,
    discountAud,
    gstAud,
    finalPriceAud,
    balanceDueAud,
    depositRequest: depositRequest
      ? {
          mode: depositRequest.mode,
          percent: depositRequest.percent,
          amountAud: depositRequest.amountAud,
          dueDate: depositRequest.dueDate,
        }
      : null,
    notes: input.notes?.trim() || null,
    termsAndConditions: (() => {
      const baseTerms = input.termsAndConditions?.trim() || null;
      if (!depositRequest) return baseTerms;
      const depositNote = formatDepositPaymentNote(depositRequest);
      return baseTerms
        ? `${baseTerms}\n\n${depositNote}`
        : depositNote;
    })(),
    invoiceDate: input.invoiceDate.trim(),
    dueDate: input.dueDate.trim(),
    status: input.send ? "sent" : "draft",
    bookingId: booking?.bookingId ?? null,
    bookingCode: booking?.bookingCode ?? null,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  });

  const saved = await docRef.get();
  const invoice = mapInvoiceDoc(saved.id, saved.data() ?? {});

  if (input.send) {
    await sendInvoiceEmailForDetail(invoice, businessId);
  }

  return {
    ok: true,
    invoice,
  };
}

async function sendInvoiceEmailForDetail(
  invoice: InvoiceDetail,
  businessId: string,
): Promise<void> {
  const email = invoice.customer.email?.trim();
  if (!email) return;

  const profile = await getBusinessProfile(businessId);

  let pdfBytes: Buffer | null = null;
  try {
    const { generateInvoicePdf } = await import("@/lib/invoices/pdf");
    pdfBytes = await generateInvoicePdf(invoice, {
      businessName: profile?.businessName ?? null,
      logoUrl: profile?.logoUrl ?? null,
      businessAddress: profile?.businessAddress ?? null,
      businessEmail: profile?.businessEmail ?? null,
      businessPhone: profile?.businessPhone ?? null,
      abn: profile?.abn ?? null,
      registeredForGst: profile?.registeredForGst ?? false,
      gstPercentage: profile?.gstPercentage ?? null,
    });
  } catch (error) {
    console.error("[invoice] PDF generation failed:", error);
  }

  if (!pdfBytes?.length) return;

  const { sendInvoiceSentEmail } = await import(
    "@/lib/email/templates/invoice-sent"
  );

  const invoiceCode = invoice.invoiceCode.trim() || "invoice";

  await sendInvoiceSentEmail({
    customerEmail: email,
    customerFullName: invoice.customer.fullName,
    invoiceNo: invoice.invoiceCode,
    serviceTitle: invoice.serviceTitle,
    dueDate: invoice.dueDate,
    totalAud: invoice.finalPriceAud,
    balanceDueAud: invoice.balanceDueAud,
    depositRequest: invoice.depositRequest,
    businessName: profile?.businessName ?? null,
    bookingSlug: profile?.bookingSlug ?? null,
    logoUrl: profile?.logoUrl ?? null,
    pdfBytes,
    pdfFileName: `${invoiceCode}.pdf`.replace(/[^a-z0-9.\-]+/gi, "-"),
  });
}
