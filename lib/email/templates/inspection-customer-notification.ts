import "server-only";

import {
  renderEmail,
  type EmailDetailRow,
  type EmailTone,
} from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { sendSms } from "@/lib/sms/textbee";
import { firstName } from "@/lib/email/templates/_shared/first-name";
import { platformBrandLogoDataUri } from "@/lib/email/templates/_shared/platform-logo";
import { appBaseUrl } from "@/lib/email/templates/_shared/urls";
import { buildBookingUrl } from "@/lib/onboarding/booking-slug";
import { formatInspectionVisitReference } from "@/lib/inspection/types";
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
  booking_on_the_way: { eyebrow: "Job on the way", tone: "brand" },
  request_cancelled: { eyebrow: "Request cancelled", tone: "danger" },
  request_completed: { eyebrow: "Visit completed", tone: "success" },
};

export type InspectionCustomerNotificationEmailInput = {
  customerEmail: string;
  customerPhone?: string | null;
  customerName?: string | null;
  bookingSlug?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
  inspectionRequestId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  emailDetails?: EmailDetailRow[];
  emailHighlight?: string | null;
  emailHighlightLabel?: string | null;
};

function resolveBusinessLogoUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = appBaseUrl();
  if (base && trimmed.startsWith("/")) return `${base}${trimmed}`;
  return null;
}

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
    const details: EmailDetailRow[] = [];
    const inspectionId = input.inspectionRequestId?.trim();
    if (inspectionId) {
      details.push({
        label: "Inspection",
        value: formatInspectionVisitReference(inspectionId),
      });
    }
    if (input.emailDetails?.length) details.push(...input.emailDetails);

    const html = renderEmail({
      eyebrow: presentation?.eyebrow ?? "Inspection request",
      tone: presentation?.tone ?? "brand",
      headerAlign: "center",
      headerHeadline: "BMS Pro Trade",
      platformLogoUrl: platformBrandLogoDataUri(),
      bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
      title: input.title,
      greetingName: firstName(input.customerName),
      body: input.body,
      details,
      highlight: input.emailHighlight ?? null,
      highlightLabel: input.emailHighlightLabel ?? null,
      ctaUrl,
      ctaLabel:
        input.type === "booking_on_the_way"
          ? "View my booking"
          : "View my request",
      footnote:
        input.type === "booking_on_the_way"
          ? "You're receiving this about your scheduled job with BMS Pro Trade."
          : "You're receiving this because you booked through BMS Pro Trade.",
      businessName: input.businessName,
      logoUrl: null,
    });
    await sendEmail({
      sender: "request",
      to: input.customerEmail,
      toName: input.customerName ?? null,
      subject: input.title,
      htmlBody: html,
    });

    if (input.customerPhone) {
      const smsBody = input.body
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
      await sendSms({
        to: input.customerPhone,
        message: smsBody ? `${input.title}. ${smsBody}` : input.title,
      });
    }
  } catch {
    /* email/SMS is best-effort */
  }
}
