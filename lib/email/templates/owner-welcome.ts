import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { firstName } from "@/lib/email/templates/_shared/first-name";
import { platformBrandLogoDataUri } from "@/lib/email/templates/_shared/platform-logo";
import { appBaseUrl, loginUrl } from "@/lib/email/templates/_shared/urls";

function resolveBusinessLogoUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = appBaseUrl();
  if (base && trimmed.startsWith("/")) return `${base}${trimmed}`;
  return null;
}

export type OwnerWelcomeEmailInput = {
  email: string;
  ownerName?: string | null;
  businessName: string;
  bookingSlug?: string | null;
  planName?: string | null;
  /** Temporary password, only for admin-created accounts. */
  temporaryPassword?: string | null;
  /** Optional business logo URL shown in the email body. */
  logoUrl?: string | null;
};

/**
 * Sends the business-owner welcome email after onboarding / account creation.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendOwnerWelcomeEmail(
  input: OwnerWelcomeEmailInput,
): Promise<boolean> {
  const details: EmailDetailRow[] = [
    { label: "Business", value: input.businessName },
  ];
  if (input.planName) details.push({ label: "Plan", value: input.planName });
  if (input.bookingSlug) {
    const base = appBaseUrl();
    details.push({
      label: "Booking page",
      value: base
        ? `${base}/booknow/${input.bookingSlug}`
        : `/booknow/${input.bookingSlug}`,
    });
  }
  if (input.temporaryPassword) {
    details.push({ label: "Temporary password", value: input.temporaryPassword });
  }

  const html = renderEmail({
    eyebrow: "Welcome aboard",
    tone: "brand",
    headerAlign: "center",
    headerHeadline: "Welcome to BMS Pro Trade",
    platformLogoUrl: platformBrandLogoDataUri(),
    bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
    title: `Your ${input.businessName} workspace is ready`,
    greetingName: firstName(input.ownerName),
    body: input.temporaryPassword
      ? `Your BMS Pro Trade account has been created. Sign in with your email and the temporary password below, then change it from your profile.\n\nFrom your dashboard you can manage bookings, inspection visits, your team, and your public booking page.`
      : `Thanks for setting up ${input.businessName} on BMS Pro Trade. Your account is ready.\n\nFrom your dashboard you can manage bookings, inspection visits, your team, and your public booking page.`,
    details,
    ctaUrl: loginUrl(),
    ctaLabel: "Go to my dashboard",
    footnote:
      "If you didn't create this account, please ignore this email or contact support.",
    businessName: input.businessName,
    logoUrl: null,
  });

  return sendEmail({
    sender: "system",
    to: input.email,
    toName: input.ownerName ?? null,
    subject: `Welcome to BMS Pro Trade — ${input.businessName}`,
    htmlBody: html,
  });
}
