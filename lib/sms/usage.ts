import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { parseBusinessSmsFields } from "@/lib/sms-packages/balance";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Atomically reserves SMS credits on a business before sending.
 * Returns false when the tenant has no remaining quota.
 */
export async function tryConsumeSmsCredits(
  businessId: string,
  count: number,
): Promise<boolean> {
  const trimmedId = businessId.trim();
  if (!trimmedId || count <= 0) return false;

  const ref = adminDb.collection("businesses").doc(trimmedId);

  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;

      const balance = parseBusinessSmsFields(snap.data() ?? {});
      if (balance.isUnlimited) return true;

      const remaining = balance.remaining ?? 0;
      if (remaining < count) {
        console.warn("[sms] skipped — quota exceeded.", {
          businessId: trimmedId,
          limit: balance.limit,
          used: balance.used,
          remaining,
          requested: count,
        });
        return false;
      }

      tx.update(ref, {
        smsMessagesUsed: balance.used + count,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
  } catch (error) {
    console.error("[sms] quota reservation failed", {
      businessId: trimmedId,
      error,
    });
    return false;
  }
}

/** Restores credits when a reserved SMS could not be delivered. */
export async function releaseSmsCredits(
  businessId: string,
  count: number,
): Promise<void> {
  const trimmedId = businessId.trim();
  if (!trimmedId || count <= 0) return;

  const ref = adminDb.collection("businesses").doc(trimmedId);

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;

      const balance = parseBusinessSmsFields(snap.data() ?? {});
      if (balance.isUnlimited) return;

      tx.update(ref, {
        smsMessagesUsed: Math.max(0, balance.used - count),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    console.error("[sms] credit release failed", {
      businessId: trimmedId,
      error,
    });
  }
}
