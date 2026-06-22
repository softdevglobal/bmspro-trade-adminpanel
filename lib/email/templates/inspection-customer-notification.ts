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
  request_created: { eyebrow: "Request", tone: "brand" },
  request_scheduled: { eyebrow: "Visit confirmed", tone: "success" },
  request_proposed: { eyebrow: "New times proposed", tone: "warning" },
  request_assigned: { eyebrow: "Inspector assigned", tone: "success" },
  visit_on_the_way: { eyebrow: "On the way", tone: "brand" },
  booking_on_the_way: { eyebrow: "Job on the way", tone: "brand" },
  request_cancelled: { eyebrow: "Request cancelled", tone: "danger" },
  request_completed: { eyebrow: "Visit completed", tone: "success" },
  job_completed: { eyebrow: "Job completed", tone: "success" },
  invoice_sent: { eyebrow: "Invoice", tone: "brand" },
  quotation_sent: { eyebrow: "Quotation", tone: "brand" },
  quotation_accepted: { eyebrow: "Quotation accepted", tone: "success" },
  quotation_rejected: { eyebrow: "Quotation rejected", tone: "danger" },
  leave_requested: { eyebrow: "Leave request", tone: "warning" },
  leave_assignment_conflict: { eyebrow: "Schedule conflict", tone: "warning" },
  staff_off_day: { eyebrow: "Staff off day", tone: "warning" },
  // Custom messages are in-app/push only and never emailed to customers.
  system_message: { eyebrow: "Announcement", tone: "brand" },
};

export type InspectionCustomerNotificationEmailInput = {
  customerEmail: string;
  customerPhone?: string | null;
  customerName?: string | null;
  bookingSlug?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
  businessId?: string | null;
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

function customerAccountUrl(
  bookingSlug: string | null | undefined,
  tab: "requests" | "history" = "requests",
): string | null {
  if (!bookingSlug) return null;
  const base = buildBookingUrl(bookingSlug);
  if (!base) return null;
  return `${base}/account/${tab}`;
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
    const ctaUrl = customerAccountUrl(
      input.bookingSlug,
      input.type === "job_completed" || input.type === "invoice_sent"
        ? "history"
        : "requests",
    );
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
      eyebrow: presentation?.eyebrow ?? "Request",
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
          : input.type === "job_completed"
            ? "View job history"
            : input.type === "invoice_sent"
              ? "View your invoice"
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
  } catch {
    /* email is best-effort */
  }

  // SMS is sent independently so an email failure never skips the SMS.
  if (input.customerPhone) {
    const smsBody = input.body?.replace(/\s+/g, " ").trim();
    await sendSms({
      to: input.customerPhone,
      businessId: input.businessId,
      message: smsBody ? `${input.title}. ${smsBody}` : input.title,
    });
  }
}
