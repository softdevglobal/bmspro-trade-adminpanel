import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type Stripe from "stripe";

import { adminDb } from "@/lib/firebase/admin";
import { recordInvoiceStripePayment } from "@/lib/invoices/server";
import type { StripePaymentRecord } from "@/lib/payments/types";
import { recordQuotationDepositPayment } from "@/lib/quotations/server";
import { getStripe } from "@/lib/stripe/client";
import { getBusinessConnectAccount } from "@/lib/stripe/connect";
import { resolvePaymentLink } from "@/lib/stripe/payment-links";

const PAYMENT_RECEIPTS = "payment_receipts";

type PaymentType = "quotation_deposit" | "invoice_payment";

function metadataValue(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isSessionPaid(session: Stripe.Checkout.Session): boolean {
  if (session.status !== "complete") return false;
  return (
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required"
  );
}

/** Atomically reserves a checkout session so payment fulfillment runs at most once. */
async function claimReceipt(
  sessionId: string,
  businessId: string,
  type: PaymentType,
): Promise<boolean> {
  const ref = adminDb.collection(PAYMENT_RECEIPTS).doc(sessionId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.create(ref, {
      sessionId,
      businessId,
      type,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function markReceiptFulfilled(
  sessionId: string,
  record: StripePaymentRecord,
  targetId: string,
): Promise<void> {
  await adminDb.collection(PAYMENT_RECEIPTS).doc(sessionId).set(
    {
      targetId,
      kind: record.kind,
      amountAud: record.amountAud,
      feeAud: record.feeAud,
      totalChargedAud: record.totalChargedAud,
      feePayerMode: record.feePayerMode,
      stripePaymentIntentId: record.stripePaymentIntentId,
      stripeConnectedAccountId: record.stripeConnectedAccountId,
      fulfilledAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function buildPaymentRecord(
  session: Stripe.Checkout.Session,
  paymentType: PaymentType,
  connectedAccountId: string | null,
): StripePaymentRecord {
  const baseCents = Number.parseInt(
    metadataValue(session.metadata, "baseCents") ?? "",
    10,
  );
  const feeCents = Number.parseInt(
    metadataValue(session.metadata, "feeCents") ?? "",
    10,
  );
  const feePayerMode =
    metadataValue(session.metadata, "feePayerMode") === "customer"
      ? "customer"
      : "business";

  const amountAud = Number.isFinite(baseCents)
    ? baseCents / 100
    : (session.amount_total ?? 0) / 100;
  const feeAud = Number.isFinite(feeCents) ? feeCents / 100 : 0;
  const totalChargedAud =
    typeof session.amount_total === "number"
      ? session.amount_total / 100
      : Math.round((amountAud + feeAud) * 100) / 100;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  return {
    kind: paymentType,
    amountAud,
    feeAud,
    totalChargedAud,
    feePayerMode,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    stripeConnectedAccountId: connectedAccountId,
    currency: "aud",
    paidAt: Date.now(),
  };
}

/**
 * Applies a completed payment Checkout session to its quotation deposit or
 * invoice, exactly once. Non-payment sessions (subscriptions/SMS) are ignored.
 */
export async function fulfillPaymentCheckoutSession(input: {
  session: Stripe.Checkout.Session;
  connectedAccountId: string | null;
}): Promise<{ handled: boolean; alreadyFulfilled: boolean }> {
  const { session } = input;
  const paymentType = metadataValue(session.metadata, "paymentType");
  if (
    paymentType !== "quotation_deposit" &&
    paymentType !== "invoice_payment"
  ) {
    return { handled: false, alreadyFulfilled: false };
  }
  if (!isSessionPaid(session)) {
    return { handled: false, alreadyFulfilled: false };
  }

  const businessId = metadataValue(session.metadata, "businessId");
  const targetId = metadataValue(session.metadata, "targetId");
  if (!businessId || !targetId) {
    console.warn("[stripe payment] session missing businessId/targetId");
    return { handled: false, alreadyFulfilled: false };
  }

  const claimed = await claimReceipt(session.id, businessId, paymentType);
  if (!claimed) {
    return { handled: true, alreadyFulfilled: true };
  }

  try {
    const record = buildPaymentRecord(
      session,
      paymentType,
      input.connectedAccountId,
    );

    if (paymentType === "quotation_deposit") {
      const result = await recordQuotationDepositPayment(
        businessId,
        targetId,
        record,
      );
      if (!result.ok) throw new Error(result.error);
    } else {
      const result = await recordInvoiceStripePayment(
        businessId,
        targetId,
        record,
      );
      if (!result.ok) throw new Error(result.error);
    }

    await markReceiptFulfilled(session.id, record, targetId);
    return { handled: true, alreadyFulfilled: false };
  } catch (error) {
    // Release the claim so a webhook retry (or confirm) can re-run.
    await adminDb
      .collection(PAYMENT_RECEIPTS)
      .doc(session.id)
      .delete()
      .catch(() => {});
    throw error;
  }
}

/**
 * Redirect-return fallback: retrieves the session from the connected account,
 * verifies it belongs to the link, and fulfills it. Webhooks remain the primary
 * source of truth; this just makes the return UX immediate.
 */
export async function confirmPaymentSession(input: {
  token: string;
  sessionId: string;
}): Promise<
  | { ok: true; status: "paid" | "pending"; alreadyFulfilled: boolean }
  | { ok: false; status: number; error: string }
> {
  const link = await resolvePaymentLink(input.token.trim());
  if (!link) {
    return { ok: false, status: 404, error: "Payment link not found." };
  }

  const connect = await getBusinessConnectAccount(link.businessId);
  if (!connect.accountId) {
    return {
      ok: false,
      status: 400,
      error: "This business is not connected to Stripe.",
    };
  }

  let session: Stripe.Checkout.Session;
  try {
    const stripe = getStripe();
    session = await stripe.checkout.sessions.retrieve(
      input.sessionId.trim(),
      {},
      { stripeAccount: connect.accountId },
    );
  } catch (error) {
    console.error("[stripe payment] confirm retrieve failed:", error);
    return { ok: false, status: 400, error: "Could not verify the payment." };
  }

  const sessionBusinessId = metadataValue(session.metadata, "businessId");
  const sessionTargetId = metadataValue(session.metadata, "targetId");
  if (
    sessionBusinessId !== link.businessId ||
    sessionTargetId !== link.targetId
  ) {
    return {
      ok: false,
      status: 400,
      error: "This checkout session does not match the payment link.",
    };
  }

  if (!isSessionPaid(session)) {
    return { ok: true, status: "pending", alreadyFulfilled: false };
  }

  const result = await fulfillPaymentCheckoutSession({
    session,
    connectedAccountId: connect.accountId,
  });
  return { ok: true, status: "paid", alreadyFulfilled: result.alreadyFulfilled };
}
