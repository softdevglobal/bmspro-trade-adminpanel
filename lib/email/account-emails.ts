import "server-only";

import { renderEmail, type EmailDetailRow } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/zeptomail";
function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BOOKING_BASE_URL ?? "").replace(/\/+$/, "");
}

function loginUrl(): string | null {
  const base = appBaseUrl();
  return base ? `${base}/login` : null;
}

export type OwnerWelcomeEmailInput = {
  email: string;
  ownerName?: string | null;
  businessName: string;
  bookingSlug?: string | null;
  planName?: string | null;
  /** Temporary password, only for admin-created accounts. */
  temporaryPassword?: string | null;
  /** Optional business logo URL shown in the email header. */
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
    title: `Your ${input.businessName} workspace is ready`,
    greetingName: input.ownerName?.trim() || null,
    body: input.temporaryPassword
      ? `Your BMS Pro Trade account has been created. Sign in with your email and the temporary password below, then change it from your profile.\n\nFrom your dashboard you can manage bookings, inspection visits, your team, and your public booking page.`
      : `Thanks for setting up ${input.businessName} on BMS Pro Trade. Your account is ready.\n\nFrom your dashboard you can manage bookings, inspection visits, your team, and your public booking page.`,
    details,
    ctaUrl: loginUrl(),
    ctaLabel: "Go to my dashboard",
    footnote:
      "If you didn't create this account, please ignore this email or contact support.",
    businessName: input.businessName,
    logoUrl: input.logoUrl ?? null,
  });

  return sendEmail({
    sender: "system",
    to: input.email,
    toName: input.ownerName ?? null,
    subject: `Welcome to BMS Pro Trade — ${input.businessName}`,
    htmlBody: html,
  });
}

export type CustomerWelcomeEmailInput = {
  email: string;
  fullName?: string | null;
  /** Business they signed up from (e.g. PD Plumbing). */
  businessName?: string | null;
  bookingSlug?: string | null;
  /** Optional business logo URL shown in the email header. */
  logoUrl?: string | null;
  /** Temporary password, only for accounts created by the business. */
  temporaryPassword?: string | null;
};

/**
 * Sends a welcome email when a customer creates a booking-side account.
 * Uses the `system` (noreply@) sender. Best-effort — never throws.
 */
export async function sendCustomerWelcomeEmail(
  input: CustomerWelcomeEmailInput,
): Promise<boolean> {
  const business = input.businessName?.trim() || "your trade provider";
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

  const html = renderEmail({
    eyebrow: "Account created",
    tone: "brand",
    title: "Your customer account is ready",
    greetingName: firstName(input.fullName),
    body: input.temporaryPassword
      ? `${business} created a BMS Pro Trade account for you so you can track your inspection visit. Sign in with the credentials below, then change your password from your account.\n\nYou can request inspection visits, track proposed times, and see confirmed visit details.`
      : `Thanks for joining BMS Pro Trade. You can now request inspection visits, track proposed times, and see confirmed visit details with ${business}.\n\nSign in anytime with the email you used to register.`,
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
    logoUrl: input.logoUrl ?? null,
  });

  return sendEmail({
    sender: "system",
    to: input.email,
    toName: input.fullName ?? null,
    subject: `Welcome — your ${business} booking account`,
    htmlBody: html,
  });
}

export type StaffWelcomeEmailInput = {
  email: string;
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
    logoUrl: input.logoUrl ?? null,
  });

  return sendEmail({
    sender: "system",
    to: input.email,
    toName: input.fullName,
    subject: `Welcome to the team — ${input.businessName}`,
    htmlBody: html,
  });
}

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

function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}
