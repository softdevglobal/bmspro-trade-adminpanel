import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { firstName } from "@/lib/email/templates/_shared/first-name";
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
  serviceTitle: string;
  inspectionRequestId: string;
  address: InspectionAddress;
  scheduledSlot?: { date?: string; timeRange?: string } | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  lineItems: { name: string; priceAud: number }[];
  additions: { name: string; priceAud: number }[];
  subtotalAud: number;
  finalPriceAud: number;
  notes?: string | null;
  businessName?: string | null;
  bookingSlug?: string | null;
  logoUrl?: string | null;
  pdfBytes: Buffer | null;
  pdfFileName: string;
};

/**
 * Sends the customer quotation summary email with optional PDF attachment.
 * Uses the `request` sender. Best-effort — never throws.
 */
export async function sendQuotationSentEmail(
  input: QuotationSentEmailInput,
): Promise<void> {
  const email = input.customerEmail.trim();
  if (!email) return;

  try {
    const visitWindow = formatVisitWindow(
      input.scheduledStartTime ?? null,
      input.scheduledEndTime ?? null,
    );

    const visitReference = formatInspectionVisitReference(
      input.inspectionRequestId,
    );

    const details: EmailDetailRow[] = [
      { label: "Reference", value: visitReference },
      { label: "Service", value: input.serviceTitle },
      { label: "Customer", value: input.customerFullName?.trim() || "—" },
    ];
    const address = formatAddress(input.address);
    if (address) details.push({ label: "Address", value: address });
    if (input.scheduledSlot?.date) {
      details.push({
        label: "Visit date",
        value: formatSlotDate(input.scheduledSlot.date),
      });
    }
    if (visitWindow) {
      details.push({ label: "Visit time", value: visitWindow });
    }
    for (const item of input.lineItems) {
      details.push({
        label: item.name,
        value: `Aus $${item.priceAud.toFixed(2)}`,
      });
    }
    details.push({
      label: "Total item price",
      value: `Aus $${input.subtotalAud.toFixed(2)}`,
    });
    for (const addition of input.additions) {
      details.push({
        label: `+ ${addition.name}`,
        value: `Aus $${addition.priceAud.toFixed(2)}`,
      });
    }

    const bookingEngineUrl = input.bookingSlug
      ? buildBookingUrl(input.bookingSlug)
      : null;
    const businessLabel = input.businessName?.trim() || "your trade provider";

    const html = renderEmail({
      eyebrow: "Quotation",
      tone: "brand",
      title: `Quotation for ${input.serviceTitle}`,
      greetingName: firstName(input.customerFullName),
      body: `Thank you for your visit with ${businessLabel}. Here is your quotation summary from the inspection. A PDF copy is attached for your records.`,
      details,
      highlight: `Aus $${input.finalPriceAud.toFixed(2)}`,
      highlightLabel: "Final price",
      ctaUrl: bookingEngineUrl,
      ctaLabel: bookingEngineUrl ? "Go to booking engine" : undefined,
      footnote:
        input.notes?.trim() ||
        "We will follow up if any changes are needed before work begins.",
      businessName: input.businessName,
      logoUrl: input.logoUrl,
    });

    const subjectBusiness = input.businessName?.trim();
    const subject = subjectBusiness
      ? `${subjectBusiness} — Quotation — ${input.serviceTitle}`
      : `Quotation — ${input.serviceTitle}`;

    await sendEmail({
      sender: "request",
      to: email,
      subject,
      htmlBody: html,
      attachments: input.pdfBytes
        ? [
            {
              content: input.pdfBytes.toString("base64"),
              mimeType: "application/pdf",
              name: input.pdfFileName,
            },
          ]
        : undefined,
    });
  } catch {
    /* email is best-effort */
  }
}
