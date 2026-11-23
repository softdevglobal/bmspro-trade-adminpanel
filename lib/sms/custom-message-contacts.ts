/**
 * Who can get a custom SMS (Custom messages page, Sophie's SMS tools): the same people as the Customers page.
 * That is everyone who sent an inspection request, plus the customers saved on the Customers page (added by
 * hand, by voice or by import), who may never have sent a request. Only customers with a usable phone number
 * are listed. Pure: the caller passes the phone check (toE164 on the server).
 */
import type { CustomerProfile } from "@/lib/customer/types";

export type CustomerContact = { id: string; fullName: string; phone: string };

type Contact = { fullName?: string | null; email?: string | null; phone?: string | null };

/** Stable key for a customer, matching the Customers page grouping (email, then phone, then name). */
export function customerContactKey(contact: Contact): string {
  const email = contact.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = contact.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${(contact.fullName ?? "").trim().toLowerCase() || "unknown"}`;
}

/** The deduped list of customers with a usable phone number, sorted by name. */
export function buildCustomerContacts(
  requestCustomers: Contact[],
  savedCustomers: Pick<CustomerProfile, "fullName" | "email" | "phone">[],
  isTextable: (phone: string) => boolean,
): CustomerContact[] {
  const map = new Map<string, CustomerContact>();
  for (const contact of [...requestCustomers, ...savedCustomers]) {
    const phone = contact.phone?.trim();
    if (!phone || !isTextable(phone)) continue;

    const key = customerContactKey(contact);
    const existing = map.get(key);
    if (existing) {
      if (existing.fullName === "Unknown customer" && contact.fullName?.trim()) existing.fullName = contact.fullName.trim();
      continue;
    }
    map.set(key, { id: key, fullName: contact.fullName?.trim() || "Unknown customer", phone });
  }
  return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}
