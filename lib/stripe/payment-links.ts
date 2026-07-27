import "server-only";

import { randomBytes } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import type { PaymentLinkType } from "@/lib/payments/types";

export const PAYMENT_LINK_COLLECTION = "payment_links";

export type PaymentLink = {
  token: string;
  type: PaymentLinkType;
  businessId: string;
  targetId: string;
};

function mapPaymentLink(
  token: string,
  data: Record<string, unknown>,
): PaymentLink | null {
  const type = data.type === "invoice" ? "invoice" : data.type === "quotation" ? "quotation" : null;
  const businessId =
    typeof data.businessId === "string" ? data.businessId.trim() : "";
  const targetId =
    typeof data.targetId === "string" ? data.targetId.trim() : "";
  if (!type || !businessId || !targetId) return null;
  return { token, type, businessId, targetId };
}

/**
 * Returns a stable secure payment token for a quotation deposit or invoice,
 * creating one on first use. Reused across generations so the shared link stays
 * constant for a given document.
 */
export async function getOrCreatePaymentLink(input: {
  type: PaymentLinkType;
  businessId: string;
  targetId: string;
}): Promise<PaymentLink> {
  const existing = await adminDb
    .collection(PAYMENT_LINK_COLLECTION)
    .where("type", "==", input.type)
    .where("targetId", "==", input.targetId)
    .where("businessId", "==", input.businessId)
    .limit(1)
    .get();

  if (!existing.empty) {
    const doc = existing.docs[0];
    const mapped = mapPaymentLink(doc.id, doc.data() ?? {});
    if (mapped) return mapped;
  }

  const token = randomBytes(24).toString("base64url");
  await adminDb.collection(PAYMENT_LINK_COLLECTION).doc(token).set({
    type: input.type,
    businessId: input.businessId,
    targetId: input.targetId,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    token,
    type: input.type,
    businessId: input.businessId,
    targetId: input.targetId,
  };
}

/** Resolves a secure payment token to its quotation/invoice target. */
export async function resolvePaymentLink(
  token: string,
): Promise<PaymentLink | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const snap = await adminDb
    .collection(PAYMENT_LINK_COLLECTION)
    .doc(trimmed)
    .get();
  if (!snap.exists) return null;
  return mapPaymentLink(snap.id, snap.data() ?? {});
}

/** Builds the public payment page path for a token. */
export function paymentLinkPath(link: PaymentLink): string {
  return `/pay/${link.type}/${link.token}`;
}
