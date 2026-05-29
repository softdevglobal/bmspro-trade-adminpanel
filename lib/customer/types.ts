/**
 * Shared types for customer (booking-side) accounts.
 *
 * Firestore `customers/{uid}` registration fields (set once on signup):
 * - registeredBusinessId
 * - registeredBookingSlug
 * - registeredBusinessName
 */

export const CUSTOMER_COLLECTION = "customers";

export type CustomerProfile = {
  uid: string;
  email: string;
  fullName: string;
  phone: string;
  registeredBusinessId: string | null;
  registeredBookingSlug: string | null;
  registeredBusinessName: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CustomerProfileInput = {
  fullName: string;
  phone: string;
  /** Booking slug from `/booknow/[slug]` — saved on first signup only. */
  bookingSlug?: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function validateCustomerProfileInput(
  raw: unknown,
):
  | { ok: true; value: CustomerProfileInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid profile data." };
  }
  const item = raw as Record<string, unknown>;
  const fullName =
    typeof item.fullName === "string" ? item.fullName.trim() : "";
  const phone =
    typeof item.phone === "string" ? normalizePhone(item.phone) : "";
  const bookingSlugRaw =
    typeof item.bookingSlug === "string" ? item.bookingSlug.trim() : "";
  const bookingSlug = bookingSlugRaw.length > 0 ? bookingSlugRaw : undefined;

  if (fullName.length < 2) {
    return { ok: false, error: "Enter your full name." };
  }
  if (phone.length < 6) {
    return { ok: false, error: "Enter a valid mobile number." };
  }
  return { ok: true, value: { fullName, phone, bookingSlug } };
}
