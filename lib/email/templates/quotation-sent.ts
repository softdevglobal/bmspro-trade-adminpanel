import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { firstName } from "@/lib/email/templates/_shared/first-name";
import { platformBrandLogoDataUri } from "@/lib/email/templates/_shared/platform-logo";
import { appBaseUrl } from "@/lib/email/templates/_shared/urls";
import { buildBookingUrl } from "@/lib/onboarding/booking-slug";
import {
  formatAddress,
  formatInspectionVisitReference,
  formatSlotDate,
  formatVisitWindow,
  type InspectionAddress,
} from "@/lib/inspection/types";

export type QuotationSentEmailInput = {
  customerEmail: string;
  customerFullName?: string | null;
  quoteNo: string;
  serviceTitle: string;
  validUntil?: string | null;
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

function buildQuotationEmailDetails(
  input: QuotationSentEmailInput,
): EmailDetailRow[] {
  const details: EmailDetailRow[] = [
    { label: "Quote reference", value: input.quoteNo.trim() || "—" },
    {
      label: "Service",
      value: input.serviceTitle.trim() || "—",
    },
  ];

  if (input.validUntil?.trim()) {
    details.push({
      label: "Valid until",
      value: formatQuoteDate(input.validUntil.trim()),
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
 * Sends the customer their quotation PDF with a short summary in the email body.
 * Uses the `request` sender. Best-effort — never throws.
 */
export async function sendQuotationSentEmail(
  input: QuotationSentEmailInput,
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
    const details = buildQuotationEmailDetails(input);

    const html = renderEmail({
      eyebrow: "Quotation",
      tone: "brand",
      headerAlign: "center",
      headerHeadline: "BMS Pro Trade",
      platformLogoUrl: platformBrandLogoDataUri(),
      bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
      title: `Quotation for ${input.serviceTitle}`,
      greetingName: firstName(input.customerFullName),
      body: `Please find your quotation from ${businessLabel} for ${serviceTitle} attached as a PDF.\n\nThe summary below matches the attached document. Open the PDF for the full line-item breakdown, terms, and conditions.`,
      details,
      highlight: deposit
        ? formatEmailAud(input.balanceDueAud)
        : formatEmailAud(input.totalAud),
      highlightLabel: deposit ? "Balance due" : "Total",
      ctaUrl: bookingEngineUrl,
      ctaLabel: bookingEngineUrl ? "View your account" : undefined,
      footnote:
        "The full quotation is attached as a PDF. If you have any questions, reply to this email.",
      businessName: input.businessName,
      logoUrl: null,
    });

    const subjectBusiness = input.businessName?.trim();
    const subject = subjectBusiness
      ? `${subjectBusiness} — Quotation — ${serviceTitle}`
      : `Quotation — ${serviceTitle}`;

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
