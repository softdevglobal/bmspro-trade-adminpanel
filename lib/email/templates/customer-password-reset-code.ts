import "server-only";

import { renderEmail } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { sendSms } from "@/lib/sms/textbee";
import { platformBrandLogoDataUri } from "@/lib/email/templates/_shared/platform-logo";
import { appBaseUrl } from "@/lib/email/templates/_shared/urls";

function resolveBusinessLogoUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = appBaseUrl();
  if (base && trimmed.startsWith("/")) return `${base}${trimmed}`;
  return null;
}

export type CustomerPasswordResetCodeEmailInput = {
  email: string;
  phone?: string | null;
  code: string;
  businessName?: string | null;
  logoUrl?: string | null;
  businessId?: string | null;
};

/**
 * Sends a 6-digit password reset code email for customer booking accounts.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendCustomerPasswordResetCodeEmail(
  input: CustomerPasswordResetCodeEmailInput,
): Promise<boolean> {
  const business = input.businessName?.trim() || null;
  const body = business
    ? `Use the 6-digit code below to reset your BMS Pro Trade customer password for ${business}. This code expires in 2 minutes.`
    : "Use the 6-digit code below to reset your BMS Pro Trade customer password. This code expires in 2 minutes.";

  const html = renderEmail({
    eyebrow: "Password reset",
    tone: "brand",
    headerAlign: "center",
    headerHeadline: "BMS Pro Trade",
    platformLogoUrl: platformBrandLogoDataUri(),
    bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
    title: business
      ? `Reset your ${business} customer password`
      : "Reset your customer password",
    body,
    highlight: input.code,
    highlightLabel: "Your verification code",
    footnote:
      "If you didn't request a password reset, you can safely ignore this email. Your password will not change.",
    businessName: business,
    logoUrl: null,
  });

  const subjectBusiness = business ? `${business} · ` : "";

  const sent = await sendEmail({
    sender: "system",
    to: input.email,
    subject: `${input.code} — ${subjectBusiness}BMS Pro Trade customer password reset`,
    htmlBody: html,
  });

  if (input.phone) {
    await sendSms({
      to: input.phone,
      businessId: input.businessId,
      senderName: business,
      
      source: "customer_password_reset",
      message: `${input.code} is your BMS Pro Trade${business ? ` (${business})` : ""} customer password reset code. It expires in 2 minutes.`,
    });
  }

  return sent;
}
