import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { firstName } from "@/lib/email/templates/_shared/first-name";
import { buildBookingUrl } from "@/lib/onboarding/booking-slug";
import {
  buildQuotationDocumentDeposit,
  formatDepositSummary,
  formatQuoteDate,
} from "@/lib/quotations/document";

export type InvoiceSentEmailInput = {
  customerEmail: string;
  customerFullName?: string | null;
  invoiceNo: string;
  serviceTitle: string;
  dueDate?: string | null;
  totalAud: number;
  balanceDueAud: number;
  depositRequest?: {
    amountAud: number;
    dueDate: string;
    mode?: "percent" | "fixed";
    percent?: number;
  } | null;
  businessName?: string | null;
  bookingSlug?: string | null;
  logoUrl?: string | null;
  pdfBytes: Buffer;
  pdfFileName: string;
};

function formatEmailAud(value: number): string {
  return `Aus $${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function buildInvoiceEmailDetails(input: InvoiceSentEmailInput): EmailDetailRow[] {
  const details: EmailDetailRow[] = [
    { label: "Invoice reference", value: input.invoiceNo.trim() || "—" },
    {
      label: "Service",
      value: input.serviceTitle.trim() || "—",
    },
  ];

  if (input.dueDate?.trim()) {
    details.push({
      label: "Due date",
      value: formatQuoteDate(input.dueDate.trim()),
    });
  }

  details.push({
    label: "Total",
    value: formatEmailAud(input.totalAud),
  });

  const deposit = buildQuotationDocumentDeposit(
    input.totalAud,
    input.depositRequest,
  );
  if (deposit) {
    details.push({
      label: "Deposit due",
      value: `${formatEmailAud(deposit.amountAud)} (${formatDepositSummary(deposit)})`,
    });
    details.push({
      label: "Balance due",
      value: formatEmailAud(input.balanceDueAud),
    });
  }

  return details;
}

/**
 * Sends the customer their invoice PDF with a short summary in the email body.
 * Uses the `request` sender. Best-effort — never throws.
 */
export async function sendInvoiceSentEmail(
  input: InvoiceSentEmailInput,
): Promise<void> {
  const email = input.customerEmail.trim();
  if (!email || !input.pdfBytes?.length) return;

  try {
    const businessLabel = input.businessName?.trim() || "your trade provider";
    const serviceTitle = input.serviceTitle.trim() || "your job";
    const bookingEngineUrl = input.bookingSlug
      ? buildBookingUrl(input.bookingSlug)
      : null;

    const deposit = buildQuotationDocumentDeposit(
      input.totalAud,
      input.depositRequest,
    );
    const details = buildInvoiceEmailDetails(input);

    const html = renderEmail({
      eyebrow: "Invoice",
      tone: "brand",
      title: "Your invoice is ready",
      greetingName: firstName(input.customerFullName),
      body: `Please find your invoice from ${businessLabel} for ${serviceTitle} attached as a PDF.\n\nThe summary below matches the attached document. Open the PDF for the full line-item breakdown, terms, and payment details.`,
      details,
      highlight: deposit
        ? formatEmailAud(input.balanceDueAud)
        : formatEmailAud(input.totalAud),
      highlightLabel: deposit ? "Balance due" : "Total due",
      ctaUrl: bookingEngineUrl,
      ctaLabel: bookingEngineUrl ? "View your account" : undefined,
      footnote:
        "The full invoice is attached as a PDF. If you have any questions, reply to this email.",
      businessName: input.businessName,
      logoUrl: input.logoUrl,
    });

    const subjectBusiness = input.businessName?.trim();
    const subject = subjectBusiness
      ? `${subjectBusiness} — Invoice — ${serviceTitle}`
      : `Invoice — ${serviceTitle}`;

    await sendEmail({
      sender: "request",
      to: email,
      subject,
      htmlBody: html,
      attachments: [
        {
          content: input.pdfBytes.toString("base64"),
          mimeType: "application/pdf",
          name: input.pdfFileName,
        },
      ],
    });
  } catch {
    /* email is best-effort */
  }
}
