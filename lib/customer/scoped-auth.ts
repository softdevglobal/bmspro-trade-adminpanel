import { normalizeEmail } from "@/lib/customer/types";

function customerAuthEmailDomain(): string {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  return projectId ? `${projectId}.firebaseapp.com` : "customer-auth.local";
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function scopedAuthLocalPart(
  bookingSlug: string,
  displayEmail: string,
): Promise<string> {
  const slug = bookingSlug.trim().toLowerCase();
  if (!slug) {
    throw new Error("Booking slug is required.");
  }
  const payload = new TextEncoder().encode(
    `${slug}\0${normalizeEmail(displayEmail)}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return `c_${toBase64Url(new Uint8Array(digest)).slice(0, 43)}`;
}

/** Firebase Auth email — unique per business + display email pair. */
export async function buildCustomerAuthEmail(
  bookingSlug: string,
  displayEmail: string,
): Promise<string> {
  const local = await scopedAuthLocalPart(bookingSlug, displayEmail);
  return `${local}@${customerAuthEmailDomain()}`;
}

export function isScopedCustomerAuthEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const domain = customerAuthEmailDomain().toLowerCase();
  return normalized.startsWith("c_") && normalized.endsWith(`@${domain}`);
}

/** Never show the internal Firebase Auth email in the customer UI. */
export function resolveCustomerDisplayEmail(
  profileEmail: string | null | undefined,
  authEmail: string | null | undefined,
): string {
  const profile = profileEmail?.trim() ?? "";
  if (profile && !isScopedCustomerAuthEmail(profile)) {
    return profile;
  }
  const auth = authEmail?.trim() ?? "";
  if (auth && !isScopedCustomerAuthEmail(auth)) {
    return auth;
  }
  return "";
}

/** Reset-code doc id — scoped per business so the same email can reset per tenant. */
export function customerPasswordResetDocId(
  bookingSlug: string,
  displayEmail: string,
): string {
  const slug = bookingSlug.trim().toLowerCase();
  return `${slug}:${normalizeEmail(displayEmail)}`;
}
