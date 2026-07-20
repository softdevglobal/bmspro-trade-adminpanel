import "server-only";

import type { InvoiceDetail } from "@/lib/invoices/types";
import {
  buildQuotationDocumentDeposit,
  computeDocumentTotals,
  formatQuoteDate,
  resolveDocumentLineFromQuotationItem,
  type QuotationDocumentData,
  type QuotationDocumentLineItem,
} from "@/lib/quotations/document";
import { generateDocumentPdf } from "@/lib/quotations/pdf";

function lineItemsFromInvoice(
  invoice: InvoiceDetail,
  defaultGst: number,
): QuotationDocumentLineItem[] {
  return invoice.lineItems.map((item) =>
    resolveDocumentLineFromQuotationItem(item, defaultGst),
  );
}

export function buildInvoiceDocumentFromDetail(
  invoice: InvoiceDetail,
  branding: {
    businessName?: string | null;
    logoUrl?: string | null;
    businessAddress?: string | null;
    businessEmail?: string | null;
    businessPhone?: string | null;
    abn?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
  },
): QuotationDocumentData {
  const gstPercentage = branding.registeredForGst
    ? (branding.gstPercentage ?? 10)
    : 0;
  const lineItems = lineItemsFromInvoice(invoice, gstPercentage);
  const discountAud = invoice.discountAud ?? 0;
  const totals = computeDocumentTotals({ lineItems, discountAud });
  const totalAud = invoice.finalPriceAud || totals.totalAud;
  // Pricing mode isn't stored, so derive GST from the authoritative saved total
  // to keep subtotal − discount + GST = total for inclusive-priced invoices too.
  const gstAud = Math.max(
    0,
    Math.round((totalAud - Math.max(0, totals.subtotalAud - discountAud)) * 100) /
      100,
  );

  return {
    quoteNo: invoice.invoiceCode,
    quoteDate: formatQuoteDate(invoice.invoiceDate),
    validUntil: invoice.dueDate,
    serviceTitle: invoice.serviceTitle?.trim()
      ? invoice.serviceTitle.trim()
      : null,
    customer: invoice.customer,
    customerAddress: invoice.address,
    lineItems,
    subtotalAud: totals.subtotalAud,
    discountAud,
    gstAud,
    totalAud,
    deposit: buildQuotationDocumentDeposit(totalAud, invoice.depositRequest),
    termsAndConditions: invoice.termsAndConditions?.trim()
      ? invoice.termsAndConditions.trim()
      : null,
    paymentInstructions: null,
    notes: invoice.notes?.trim() ? invoice.notes.trim() : null,
    business: {
      businessName: branding.businessName?.trim() || "Business",
      logoUrl: branding.logoUrl ?? null,
      address: branding.businessAddress ?? null,
      email: branding.businessEmail ?? null,
      phone: branding.businessPhone ?? null,
      abn: branding.abn ?? null,
      registeredForGst: Boolean(branding.registeredForGst),
      gstPercentage,
    },
  };
}

/** Renders a branded A4 invoice PDF and returns the raw bytes. */
export async function generateInvoicePdf(
  invoice: InvoiceDetail,
  branding: {
    businessName?: string | null;
    logoUrl?: string | null;
    businessAddress?: string | null;
    businessEmail?: string | null;
    businessPhone?: string | null;
    abn?: string | null;
    registeredForGst?: boolean;
    gstPercentage?: number | null;
  } = {},
): Promise<Buffer> {
  const data = buildInvoiceDocumentFromDetail(invoice, branding);
  return generateDocumentPdf(data, "invoice");
}
