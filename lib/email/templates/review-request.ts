import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { sendSms } from "@/lib/sms/textbee";
import { firstName } from "@/lib/email/templates/_shared/first-name";

export type ReviewRequestEmailInput = {
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerFullName?: string | null;
  invoiceNo?: string | null;
  serviceTitle?: string | null;
  googleReviewUrl: string;
  businessName?: string | null;
  logoUrl?: string | null;
  businessId?: string | null;
};

/**
 * Asks the customer to leave a Google review after a paid job.
 * Sends email and/or SMS independently (best-effort — never throws).
 */
export async function sendReviewRequestEmail(
  input: ReviewRequestEmailInput,
): Promise<void> {
  const reviewUrl = input.googleReviewUrl.trim();
  if (!reviewUrl) return;

  const email = input.customerEmail?.trim() || "";
  const phone = input.customerPhone?.trim() || "";
  if (!email && !phone) return;

  const businessLabel = input.businessName?.trim() || "your trade provider";
  const serviceTitle = input.serviceTitle?.trim() || "your recent job";
  const invoiceNo = input.invoiceNo?.trim() || "";

  if (email) {
    try {
      const details: EmailDetailRow[] = [
        {
          label: "Service",
          value: serviceTitle,
        },
      ];
      if (invoiceNo) {
        details.push({
          label: "Invoice reference",
          value: invoiceNo,
        });
      }

      const html = renderEmail({
        eyebrow: "Review",
        tone: "brand",
        title: "We'd love your feedback",
        greetingName: firstName(input.customerFullName),
        body: `Thanks for choosing ${businessLabel} for ${serviceTitle}.\n\nIf you were happy with our work, a quick Google review helps other customers find us — it only takes a minute.`,
        details,
        ctaUrl: reviewUrl,
        ctaLabel: "Leave a Google review",
        footnote:
          "Thank you again for your business. If you have any questions, reply to this email.",
        businessName: input.businessName,
        logoUrl: input.logoUrl,
      });

      const subjectBusiness = input.businessName?.trim();
      const subject = subjectBusiness
        ? `${subjectBusiness} — How did we do?`
        : "How did we do? Leave a Google review";

      await sendEmail({
        sender: "request",
        to: email,
        subject,
        htmlBody: html,
      });
    } catch {
      /* email is best-effort */
    }
  }

  // SMS is sent independently so an email failure never skips the SMS.
  if (phone) {
    await sendSms({
      to: phone,
      businessId: input.businessId,
      senderName: businessLabel,
      source: "review_request",
      message: `${businessLabel}: Thanks for choosing us! Please leave a Google review: ${reviewUrl}`,
    });
  }
}
