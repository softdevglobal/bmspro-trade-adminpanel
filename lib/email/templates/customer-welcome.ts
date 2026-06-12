import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { sendSms } from "@/lib/sms/textbee";
import { firstName } from "@/lib/email/templates/_shared/first-name";
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

export type CustomerWelcomeEmailInput = {
  email: string;
  phone?: string | null;
  fullName?: string | null;
  /** Business they signed up from (e.g. PD Plumbing). */
  businessName?: string | null;
  bookingSlug?: string | null;
  /** Optional business logo URL shown in the email body. */
  logoUrl?: string | null;
  /** Temporary password, only for accounts created by the business. */
  temporaryPassword?: string | null;
  context?: "quotation" | "inspection" | null;
};

/**
 * Sends a welcome email when a customer creates a booking-side account.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendCustomerWelcomeEmail(
  input: CustomerWelcomeEmailInput,
): Promise<boolean> {
  const business = input.businessName?.trim() || "your trade provider";
  const businessTitle = input.businessName?.trim()
    ? `${input.businessName.trim()} customer account`
    : "customer account";
  const slug = input.bookingSlug?.trim();
  const base = appBaseUrl();
  const accountUrl = slug
    ? base
      ? `${base}/booknow/${slug}/account`
      : `/booknow/${slug}/account`
    : base
      ? `${base}/booknow`
      : null;

  const details: EmailDetailRow[] = [{ label: "Email", value: input.email }];
  if (input.businessName) {
    details.unshift({ label: "Booking with", value: input.businessName });
  }

  const portalLine =
    input.context === "quotation"
      ? "view quotations, request visits, and track your jobs"
      : input.context === "inspection"
        ? "track your requests and proposed times"
        : "submit requests, track proposed times, and see confirmed visit details";

  const html = renderEmail({
    eyebrow: "Account created",
    tone: "brand",
    headerAlign: "center",
    headerHeadline: "Welcome to BMS Pro Trade",
    platformLogoUrl: platformBrandLogoDataUri(),
    bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
    title: `Your ${businessTitle} is ready`,
    greetingName: firstName(input.fullName),
    body: input.temporaryPassword
      ? `${business} created a BMS Pro Trade account for you so you can ${portalLine}. Sign in with the credentials below, then change your password from your account.`
      : `Thanks for joining BMS Pro Trade. You can now ${portalLine} with ${business}.\n\nSign in anytime with the email you used to register.`,
    details,
    loginCredentials: input.temporaryPassword
      ? {
          email: input.email,
          password: input.temporaryPassword,
          label: "Your login credentials",
        }
      : undefined,
    ctaUrl: accountUrl,
    ctaLabel: slug ? "View my account" : "Open booking",
    footnote:
      "If you didn't create this account, you can ignore this email.",
    businessName: input.businessName ?? null,
    logoUrl: null,
  });

  const sent = await sendEmail({
    sender: "system",
    to: input.email,
    toName: input.fullName ?? null,
    subject: `Welcome — your ${business} booking account`,
    htmlBody: html,
  });

  if (input.phone) {
    await sendSms({
      to: input.phone,
      message: input.temporaryPassword
        ? `Welcome to ${business} on BMS Pro Trade. A customer account was created for ${input.email}. Check your email for your login details.`
        : `Welcome to ${business} on BMS Pro Trade. Your customer account for ${input.email} is ready. Check your email for details.`,
    });
  }

  return sent;
}
