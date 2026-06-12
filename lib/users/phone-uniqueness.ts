/**
 * System-wide contact number uniqueness for internal accounts.
 *
 * Owners and staff must each have a unique contact number across the whole
 * platform. This covers:
 * - `users.phone`            — staff (and any owner user docs with a phone)
 * - `businesses.businessPhone` — the owner/business contact number
 *
 * Customers (`customers` collection) are intentionally excluded: the same
 * customer email/phone may register against different booking engines.
 */

import "server-only";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Normalises a phone number into a comparison key so that
 * "+61 412 345 678", "0412345678" and "61412345678" all match.
 * Returns null when the value has no usable digits.
 */
export function phoneComparisonKey(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0061")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("61") && digits.length > 9) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, "");
  return digits.length >= 6 ? digits : null;
}

export type PhoneConflict =
  | { type: "user"; id: string }
  | { type: "business"; id: string };

/**
 * Returns the first owner/staff account or business already using the given
 * contact number, or null when the number is free.
 */
export async function findStaffOwnerPhoneConflict(
  phone: string,
  options: { excludeUserUid?: string; excludeBusinessId?: string } = {},
): Promise<PhoneConflict | null> {
  const key = phoneComparisonKey(phone);
  if (!key) return null;

  const [usersSnap, businessesSnap] = await Promise.all([
    adminDb.collection("users").select("phone").get(),
    adminDb.collection("businesses").select("businessPhone").get(),
  ]);

  for (const doc of usersSnap.docs) {
    if (doc.id === options.excludeUserUid) continue;
    const candidate = doc.get("phone") as string | undefined;
    if (phoneComparisonKey(candidate) === key) {
      return { type: "user", id: doc.id };
    }
  }

  for (const doc of businessesSnap.docs) {
    if (doc.id === options.excludeBusinessId) continue;
    const candidate = doc.get("businessPhone") as string | undefined;
    if (phoneComparisonKey(candidate) === key) {
      return { type: "business", id: doc.id };
    }
  }

  return null;
}

export const PHONE_TAKEN_ERROR =
  "This contact number is already used by another owner or staff member.";
