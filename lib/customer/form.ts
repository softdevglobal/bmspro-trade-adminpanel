/**
 * Add / Edit customer: the rules shared by the popup (browser), the API routes, the voice browser
 * tool and the owner MCP tools. Pure: no server-only imports.
 */
import { isValidEmail, normalizeEmail, normalizePhone } from "./types";

export const CUSTOMER_FORM_LIMITS = {
  nameMin: 2, nameMax: 120,
  phoneMinDigits: 6, phoneMaxDigits: 15,
  companyMax: 120, notesMax: 1000,
  addressPartMax: 120,
} as const;
const L = CUSTOMER_FORM_LIMITS;

export type CustomerAddress = { street: string; suburb: string; state: string; postcode: string };

/** What the owner types into the Add / Edit customer popup. */
export type CustomerFormInput = {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
  address: CustomerAddress | null;
};

export const EMPTY_CUSTOMER_FORM: CustomerFormInput = {
  fullName: "", email: "", phone: "", company: "", notes: "", address: null,
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Cleans and checks the form. `error` is plain language, safe to show or read out. */
export function validateCustomerForm(
  raw: unknown,
): { ok: true; value: CustomerFormInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Enter the customer's details." };
  const r = raw as Record<string, unknown>;
  const fullName = text(r.fullName, L.nameMax);
  if (fullName.length < L.nameMin) return { ok: false, error: "Name must be at least 2 characters." };
  const email = normalizeEmail(text(r.email, 254));
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  const phone = text(r.phone, 40);
  const digits = normalizePhone(phone);
  if (digits.length < L.phoneMinDigits || digits.length > L.phoneMaxDigits) {
    return { ok: false, error: "Enter a valid mobile number." };
  }
  let address: CustomerAddress | null = null;
  if (r.address && typeof r.address === "object") {
    const a = r.address as Record<string, unknown>;
    const parts = {
      street: text(a.street, L.addressPartMax), suburb: text(a.suburb, L.addressPartMax),
      state: text(a.state, 10), postcode: text(a.postcode, 10),
    };
    if (parts.street || parts.suburb || parts.state || parts.postcode) address = parts;
  }
  return {
    ok: true,
    value: { fullName, email, phone, company: text(r.company, L.companyMax), notes: text(r.notes, L.notesMax), address },
  };
}

/** Same email or same phone digits = the same customer. */
export function sameCustomer(
  a: { email: string; phone: string },
  b: { email: string; phone: string },
): "email" | "phone" | null {
  if (a.email && b.email && normalizeEmail(a.email) === normalizeEmail(b.email)) return "email";
  const pa = normalizePhone(a.phone);
  const pb = normalizePhone(b.phone);
  if (pa.length >= L.phoneMinDigits && pa === pb) return "phone";
  return null;
}

/** Browser event fired after a customer is added or changed, so an open Customers page reloads. */
export const CUSTOMERS_CHANGED_EVENT = "trade:customers-changed";
