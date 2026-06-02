import "server-only";

import { renderEmail } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { platformBrandLogoDataUri } from "@/lib/email/templates/_shared/platform-logo";

export type PasswordResetCodeEmailInput = {
  email: string;
  code: string;
};

/**
 * Sends a 6-digit password reset code email.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendPasswordResetCodeEmail(
  input: PasswordResetCodeEmailInput,
): Promise<boolean> {
  const html = renderEmail({
    eyebrow: "Password reset",
    tone: "brand",
    headerAlign: "center",
    headerHeadline: "BMS Pro Trade",
    platformLogoUrl: platformBrandLogoDataUri(),
      title: "Reset your password",
    body: "Use the 6-digit code below to reset your BMS Pro Trade admin password. This code expires in 15 minutes.",
    highlight: input.code,
    highlightLabel: "Your verification code",
    footnote:
      "If you didn't request a password reset, you can safely ignore this email. Your password will not change.",
    businessName: "BMS Pro Trade",
  });

  return sendEmail({
    sender: "system",
    to: input.email,
    subject: `${input.code} — BMS Pro Trade password reset code`,
    htmlBody: html,
  });
}
