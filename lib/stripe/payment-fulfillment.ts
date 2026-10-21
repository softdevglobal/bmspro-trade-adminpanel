import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type Stripe from "stripe";
import { adminDb } from "@/lib/firebase/admin";
import { getStripe } from "@/lib/stripe/client";
import { getBusinessConnectAccount } from "@/lib/stripe/connect";
import { resolvePaymentLink } from "@/lib/stripe/payment-links";
import { matchesAuthorizedCheckout, type AuthorizedCheckout } from "@/lib/payments/checkout-record";
import { syncSettledInvoice } from "@/lib/invoices/server";

export async function fulfillPaymentCheckoutSession(input: { session: Stripe.Checkout.Session; connectedAccountId: string | null }): Promise<{ handled: boolean; alreadyFulfilled: boolean; reconciliationRequired?: boolean }> {
  const registered = await adminDb.collection("payment_checkout_sessions").doc(input.session.id).get();
  if (!registered.exists) return { handled: false, alreadyFulfilled: false };
  const expected = registered.data() as AuthorizedCheckout;
  const connect = await getBusinessConnectAccount(expected.businessId);
  if (connect.accountId !== expected.accountId || !matchesAuthorizedCheckout(input.session, expected, input.connectedAccountId)) {
    return { handled: false, alreadyFulfilled: false };
  }
  // A signed event authenticates Stripe, not an app-authorized order. Re-read
  // payment state in the registered account before committing any tenant data.
  const stripe = getStripe();
  const verified = await stripe.checkout.sessions.retrieve(expected.sessionId!, { expand: ["payment_intent"] }, { stripeAccount: expected.accountId });
  if (!matchesAuthorizedCheckout(verified, expected, expected.accountId)) return { handled: false, alreadyFulfilled: false };
  const intent = verified.payment_intent;
  if (!intent || typeof intent === "string" || intent.status !== "succeeded" || intent.amount_received !== expected.totalCents || intent.currency !== expected.currency) {
    return { handled: false, alreadyFulfilled: false };
  }
  const receiptRef = adminDb.collection("payment_receipts").doc(verified.id);
  const targetRef = adminDb.collection(expected.paymentType === "invoice_payment" ? "invoices" : "quotations").doc(expected.targetId);
  const result = await adminDb.runTransaction(async (tx) => {
    const [receipt, target] = await tx.getAll(receiptRef, targetRef);
    if (receipt.exists) return { handled: true, alreadyFulfilled: true, reconciliationRequired: receipt.data()?.reconciliationRequired === true };
    const data = target.data();
    const entry = { amountAud: expected.baseCents / 100, feeAud: expected.feeCents / 100,
      totalChargedAud: expected.totalCents / 100, feePayerMode: expected.feePayerMode,
      stripeCheckoutSessionId: verified.id, stripePaymentIntentId: intent.id,
      stripeConnectedAccountId: expected.accountId, paidAt: Date.now() };
    const outstanding = expected.paymentType === "invoice_payment" ? Math.round(Number(data?.balanceDueAud ?? 0) * 100) : Math.round(Number(data?.depositRequest?.amountAud ?? 0) * 100);
    const duplicate = expected.paymentType === "invoice_payment"
      ? data?.status === "paid" || data?.status === "cancelled" || data?.status === "draft"
      : data?.depositPayment?.status === "paid" || data?.depositRequest?.paid === true;
    const needsReview = !data || data.businessId !== expected.businessId || duplicate || !Number.isSafeInteger(outstanding) || outstanding !== expected.baseCents;
    // Extra successful charges are retained for reconciliation without changing
    // balances or replacing the first deposit. Receipt and settlement are atomic.
    tx.create(receiptRef, { ...entry, businessId: expected.businessId, targetId: expected.targetId,
      type: expected.paymentType, reconciliationRequired: needsReview,
      ...(needsReview ? { reconciliationReason: "Target changed, already paid, or payment exceeds the current balance." } : {}),
      fulfilledAt: FieldValue.serverTimestamp() });
    if (!needsReview && expected.paymentType === "invoice_payment") {
      tx.update(targetRef, { payments: FieldValue.arrayUnion(entry), amountPaidAud: Math.round((Number(data!.amountPaidAud ?? 0) * 100 + expected.baseCents)) / 100,
        balanceDueAud: 0, status: "paid", lastPaymentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    } else if (!needsReview) {
      tx.update(targetRef, { depositPayment: { ...entry, status: "paid" }, depositPayments: FieldValue.arrayUnion(entry),
        "depositRequest.paid": true, updatedAt: FieldValue.serverTimestamp() });
    }
    return { handled: true, alreadyFulfilled: false, reconciliationRequired: needsReview };
  });
  if (expected.paymentType === "invoice_payment" && !result.reconciliationRequired) {
    await syncSettledInvoice(expected.businessId, expected.targetId);
  }
  return result;
}

export async function confirmPaymentSession(input: { token: string; sessionId: string }): Promise<
  { ok: true; status: "paid" | "pending"; alreadyFulfilled: boolean } | { ok: false; status: number; error: string }> {
  const link = await resolvePaymentLink(input.token.trim());
  if (!link) return { ok: false, status: 404, error: "Payment link not found." };
  const snap = await adminDb.collection("payment_checkout_sessions").doc(input.sessionId.trim()).get();
  const expected = snap.data() as AuthorizedCheckout | undefined;
  if (!expected || expected.businessId !== link.businessId || expected.targetId !== link.targetId || expected.token !== input.token.trim()) {
    return { ok: false, status: 400, error: "This checkout session does not match the payment link." };
  }
  const session = await getStripe().checkout.sessions.retrieve(input.sessionId.trim(), {}, { stripeAccount: expected.accountId });
  if (session.status !== "complete" || session.payment_status !== "paid") return { ok: true, status: "pending", alreadyFulfilled: false };
  const result = await fulfillPaymentCheckoutSession({ session, connectedAccountId: expected.accountId });
  if (!result.handled || result.reconciliationRequired) return { ok: false, status: 409, error: "Payment needs review. Please contact the business before paying again." };
  return { ok: true, status: "paid", alreadyFulfilled: result.alreadyFulfilled };
}
