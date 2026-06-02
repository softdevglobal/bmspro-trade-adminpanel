import "server-only";

import {
  renderEmail,
  type EmailDetailRow,
  type EmailTone,
} from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { firstName } from "@/lib/email/templates/_shared/first-name";
import { buildBookingUrl } from "@/lib/onboarding/booking-slug";
import type { NotificationType } from "@/lib/notifications/types";

/** Eyebrow + tone shown in the customer email for each notification type. */
const EMAIL_PRESENTATION: Record<
  NotificationType,
  { eyebrow: string; tone: EmailTone }
> = {
  request_created: { eyebrow: "Inspection request", tone: "brand" },
  request_scheduled: { eyebrow: "Visit confirmed", tone: "success" },
  request_proposed: { eyebrow: "New times proposed", tone: "warning" },
  request_assigned: { eyebrow: "Inspector assigned", tone: "success" },
  visit_on_the_way: { eyebrow: "On the way", tone: "brand" },
  request_cancelled: { eyebrow: "Request cancelled", tone: "danger" },
  request_completed: { eyebrow: "Visit completed", tone: "success" },
};

export type InspectionCustomerNotificationEmailInput = {
  customerEmail: string;
  customerName?: string | null;
  bookingSlug?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  emailDetails?: EmailDetailRow[];
  emailHighlight?: string | null;
  emailHighlightLabel?: string | null;
};

function customerRequestUrl(bookingSlug: string | null | undefined): string | null {
  if (!bookingSlug) return null;
  const base = buildBookingUrl(bookingSlug);
  if (!base) return null;
  return `${base}/account/requests`;
}

/**
 * Best-effort email mirroring a customer inspection notification.
 * Uses the `request` sender.
 */
export async function sendInspectionCustomerNotificationEmail(
  input: InspectionCustomerNotificationEmailInput,
): Promise<void> {
  if (!input.customerEmail) return;
  try {
    const ctaUrl = customerRequestUrl(input.bookingSlug);
    const presentation = EMAIL_PRESENTATION[input.type];
    const html = renderEmail({
      eyebrow: presentation?.eyebrow ?? "Inspection request",
      tone: presentation?.tone ?? "brand",
      title: input.title,
      greetingName: firstName(input.customerName),
      body: input.body,
      details: input.emailDetails,
      highlight: input.emailHighlight ?? null,
      highlightLabel: input.emailHighlightLabel ?? null,
      ctaUrl,
      ctaLabel: "View my request",
      footnote:
        "You're receiving this because you booked through BMS Pro Trade.",
      businessName: input.businessName,
      logoUrl: input.logoUrl ?? null,
    });
    await sendEmail({
      sender: "request",
      to: input.customerEmail,
      toName: input.customerName ?? null,
      subject: input.title,
      htmlBody: html,
    });
  } catch {
    /* email is best-effort */
  }
}
