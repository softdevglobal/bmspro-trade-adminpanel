import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessAdminUids } from "@/lib/notifications/push";

/** Phone numbers for business owner/admins (for SMS reminders). */
export async function resolveBusinessAdminPhones(
  businessId: string,
): Promise<string[]> {
  const phones = new Set<string>();

  try {
    const businessSnap = await adminDb
      .collection("businesses")
      .doc(businessId)
      .get();
    const businessPhone = businessSnap.data()?.businessPhone;
    if (typeof businessPhone === "string" && businessPhone.trim()) {
      phones.add(businessPhone.trim());
    }
  } catch {
    /* best-effort */
  }

  const adminUids = await resolveBusinessAdminUids(businessId);
  await Promise.all(
    adminUids.map(async (uid) => {
      try {
        const userSnap = await adminDb.collection("users").doc(uid).get();
        const phone = userSnap.data()?.phone;
        if (typeof phone === "string" && phone.trim()) {
          phones.add(phone.trim());
        }
      } catch {
        /* best-effort */
      }
    }),
  );

  return Array.from(phones);
}
