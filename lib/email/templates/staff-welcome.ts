import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/zeptomail";
import { sendSms } from "@/lib/sms/textbee";
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

export type StaffWelcomeEmailInput = {
  email: string;
  phone?: string | null;
  fullName: string;
  businessName: string;
  staffType: string;
  temporaryPassword: string;
  logoUrl?: string | null;
};

/**
 * Sends a welcome email when a business owner adds a new team member.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendStaffWelcomeEmail(
  input: StaffWelcomeEmailInput,
): Promise<boolean> {
  const login = loginUrl();
  const details: EmailDetailRow[] = [
    { label: "Business", value: input.businessName },
    { label: "Role", value: input.staffType },
  ];
  if (login) {
    details.push({ label: "Login page", value: login });
  }

  const html = renderEmail({
    eyebrow: "Welcome to the team",
    tone: "brand",
    headerAlign: "center",
    headerHeadline: "Welcome to BMS Pro Trade",
    platformLogoUrl: platformBrandLogoDataUri(),
    bodyLogoUrl: resolveBusinessLogoUrl(input.logoUrl),
    title: `You've joined ${input.businessName}`,
    greetingName: firstName(input.fullName),
    body: `${input.businessName} added you to their team on BMS Pro Trade. Use the login credentials below to access your dashboard, view assigned inspection visits, and manage your availability.\n\nPlease change your password after your first sign-in.`,
    details,
    loginCredentials: {
      email: input.email,
      password: input.temporaryPassword,
      label: "Your login credentials",
    },
    ctaUrl: login,
    ctaLabel: "Sign in now",
    footnote:
      "Keep this email private. If you weren't expecting this invitation, contact your business owner.",
    businessName: input.businessName,
    logoUrl: null,
  });

  const sent = await sendEmail({
    sender: "system",
    to: input.email,
    toName: input.fullName,
    subject: `Welcome to the team — ${input.businessName}`,
    htmlBody: html,
  });

  if (input.phone) {
    await sendSms({
      to: input.phone,
      message: `${input.businessName} added you to their team on BMS Pro Trade as ${input.staffType}. Check your email (${input.email}) for your login details.`,
    });
  }

  return sent;
}
