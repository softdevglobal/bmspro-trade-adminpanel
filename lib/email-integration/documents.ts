import "server-only";

import { formatQuoteDate } from "@/lib/quotations/document";
import type { EmailDocumentType } from "@/lib/email-integration/types";
import { getBusinessProfile } from "@/lib/onboarding/server";
import {
  resolveInvoicePayUrl,
  resolveQuotationPayUrl,
} from "@/lib/payments/document-pay-link";
import { displayQuotationCode } from "@/lib/reference-codes";

/** What the send flow needs from a quote or invoice, loaded within one business. */
export type EmailableDocument = {
  type: EmailDocumentType;
  id: string;
  /** Changes whenever the document is saved; used to reject stale sends. */
  version: string;
  code: string;
  status: string;
  serviceTitle: string;
  customerName: string;
  customerEmail: string | null;
  totalAud: number;
  balanceDueAud: number;
  dueDate: string | null;
  validUntil: string | null;
  businessName: string;
  payUrl: string | null;
};

export function parseDocumentType(value: string): EmailDocumentType | null {
  return value === "quote" || value === "invoice" ? value : null;
}

function versionOf(updatedAt: number | null, createdAt: number | null): string {
  return String(updatedAt ?? createdAt ?? 0);
}

export async function loadEmailableDocument(
  businessId: string,
  type: EmailDocumentType,
  id: string,
): Promise<EmailableDocument | null> {
  const docId = id.trim();
  if (!docId || docId.includes("/")) return null;
  const profile = await getBusinessProfile(businessId);
  const businessName = profile?.businessName?.trim() || "Your business";
  const paymentReady = Boolean(
    profile?.stripeConnectAccountId && profile?.stripeConnectOnboarded,
  );

  if (type === "quote") {
    const { getBusinessQuotationById } = await import("@/lib/quotations/server");
    const quotation = await getBusinessQuotationById(businessId, docId);
    if (!quotation) return null;
    return {
      type,
      id: quotation.id,
      version: versionOf(quotation.updatedAt, quotation.createdAt),
      code: displayQuotationCode(quotation),
      status: quotation.status,
      serviceTitle: quotation.serviceTitle,
      customerName: quotation.customer.fullName,
      customerEmail: quotation.customer.email?.trim() || null,
      totalAud: quotation.finalPriceAud,
      balanceDueAud: quotation.balanceDueAud,
      dueDate: null,
      validUntil: quotation.validUntil,
      businessName,
      payUrl: await resolveQuotationPayUrl(businessId, quotation, paymentReady),
    };
  }

  const { getBusinessInvoiceByQuotationId } = await import("@/lib/invoices/server");
  const invoice = await getBusinessInvoiceByQuotationId(businessId, docId);
  if (!invoice) return null;
  return {
    type,
    id: invoice.id,
    version: versionOf(invoice.updatedAt, invoice.createdAt),
    code: invoice.invoiceCode.trim() || "Invoice",
    status: invoice.status,
    serviceTitle: invoice.serviceTitle,
    customerName: invoice.customer.fullName,
    customerEmail: invoice.customer.email?.trim() || null,
    totalAud: invoice.finalPriceAud,
    balanceDueAud: invoice.balanceDueAud,
    dueDate: invoice.dueDate || null,
    validUntil: null,
    businessName,
    payUrl: await resolveInvoicePayUrl(businessId, invoice, paymentReady),
  };
}

/** Drafts and cancelled documents must not reach the customer by email. */
export function documentSendBlocker(document: EmailableDocument): string | null {
  if (document.status === "draft") {
    return `Send or finalise this ${document.type === "quote" ? "quote" : "invoice"} before emailing it.`;
  }
  if (document.status === "cancelled") {
    return `This ${document.type === "quote" ? "quote" : "invoice"} is cancelled.`;
  }
  return null;
}

function formatAud(value: number): string {
  return `$${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

export function attachmentNameFor(document: EmailableDocument): string {
  const fallback = document.type === "quote" ? "quotation" : "invoice";
  return `${document.code || fallback}.pdf`.replace(/[^a-z0-9.\-]+/gi, "-");
}

/** Default subject and plain-text body; staff can edit both per send. */
export function defaultEmailContent(document: EmailableDocument): {
  subject: string;
  bodyText: string;
} {
  const label = document.type === "quote" ? "Quote" : "Invoice";
  const lines = [
    `Hi ${firstName(document.customerName)},`,
    "",
    `Please find attached ${label.toLowerCase()} ${document.code}${
      document.serviceTitle.trim() ? ` for ${document.serviceTitle.trim()}` : ""
    }.`,
    "",
    `Total: ${formatAud(document.totalAud)}`,
  ];
  if (document.type === "invoice" && document.balanceDueAud !== document.totalAud) {
    lines.push(`Balance due: ${formatAud(document.balanceDueAud)}`);
  }
  if (document.dueDate) lines.push(`Due date: ${formatQuoteDate(document.dueDate)}`);
  if (document.validUntil) {
    lines.push(`Valid until: ${formatQuoteDate(document.validUntil)}`);
  }
  if (document.payUrl) {
    lines.push(
      "",
      `${document.type === "quote" ? "Pay the deposit" : "Pay"} online: ${document.payUrl}`,
    );
  }
  lines.push(
    "",
    "If you have any questions, just reply to this email.",
    "",
    "Kind regards,",
    document.businessName,
  );
  return {
    subject: `${label} ${document.code} from ${document.businessName}`,
    bodyText: lines.join("\n"),
  };
}

/** Generates the PDF with the existing document PDF services. */
export async function generateDocumentPdf(
  businessId: string,
  document: EmailableDocument,
): Promise<Buffer | null> {
  const result =
    document.type === "quote"
      ? await (await import("@/lib/quotations/server")).getBusinessQuotationPdf(
          businessId,
          document.id,
        )
      : await (await import("@/lib/invoices/server")).getBusinessInvoicePdf(
          businessId,
          document.id,
        );
  return result.ok ? result.pdfBytes : null;
}
