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

export type PasswordResetCodeEmailInput = {
  email: string;
  phone?: string | null;
  code: string;
  /** Owner business name when the account belongs to a tenant. */
  businessName?: string | null;
  /** Business logo shown in the email body (above the title). */
  logoUrl?: string | null;
};

/**
 * Sends a 6-digit password reset code email.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendPasswordResetCodeEmail(
  input: PasswordResetCodeEmailInput,
): Promise<boolean> {
  const business = input.businessName?.trim() || null;
  const body = business
    ? `Use the 6-digit code below to reset your BMS Pro Trade admin password for ${business}. This code expires in 15 minutes.`
    : "Use the 6-digit code below to reset your BMS Pro Trade admin password. This code expires in 15 minutes.";

  const html = renderEmail({
    eyebrow: "Password reset",
    tone: "brand",
    headerAlign: "center",
    headerHeadline: "BMS Pro Trade",
    platformLogoUrl: platformBrandLogoDataUri(),
    bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
    title: business ? `Reset your ${business} password` : "Reset your password",
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
    subject: `${input.code} — ${subjectBusiness}BMS Pro Trade password reset code`,
    htmlBody: html,
  });

  if (input.phone) {
    await sendSms({
      to: input.phone,
      message: `${input.code} is your BMS Pro Trade${business ? ` (${business})` : ""} password reset code. It expires in 15 minutes.`,
    });
  }

  return sent;
}
