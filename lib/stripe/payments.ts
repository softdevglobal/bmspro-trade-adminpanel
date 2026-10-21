import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import type { AuthorizedCheckout } from "@/lib/payments/checkout-record";

import type Stripe from "stripe";

import { getPublicPaymentContext } from "@/lib/payments/public";
import { getStripe } from "@/lib/stripe/client";
import { getAppBaseUrl } from "@/lib/stripe/config";
import { getBusinessConnectAccount } from "@/lib/stripe/connect";

export type CreatePaymentSessionResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; status: number; error: string };

/**
 * Creates a Stripe Checkout session (Direct Charge on the connected account)
 * for a quotation deposit or invoice. The amount is computed on the server from
 * the token's stored records — never from client input.
 */
export async function createPaymentCheckoutSession(
  token: string,
): Promise<CreatePaymentSessionResult> {
  const context = await getPublicPaymentContext(token);
  if (!context) {
    return { ok: false, status: 404, error: "Payment link not found." };
  }
  if (context.alreadyPaid) {
    return {
      ok: false,
      status: 409,
      error: "This payment has already been completed.",
    };
  }
  if (!context.canPay) {
    return {
      ok: false,
      status: 400,
      error: context.disabledReason ?? "This payment cannot be processed.",
    };
  }

  const connect = await getBusinessConnectAccount(context.businessId);
  if (!connect.accountId || !connect.onboarded) {
    return {
      ok: false,
      status: 400,
      error: "This business is not ready to accept online payments yet.",
    };
  }

  const stripe = getStripe();
  const base = getAppBaseUrl();
  const amounts = context.amounts;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: amounts.currency,
        product_data: { name: context.title },
        unit_amount: amounts.baseCents,
      },
      quantity: 1,
    },
  ];
  if (amounts.feeCents > 0) {
    lineItems.push({
      price_data: {
        currency: amounts.currency,
        product_data: { name: "Card processing fee" },
        unit_amount: amounts.feeCents,
      },
      quantity: 1,
    });
  }

  const paymentType =
    context.type === "quotation" ? "quotation_deposit" : "invoice_payment";
  const returnBase = `${base}/pay/${context.type}/${context.token}`;

  const targetKey = createHash("sha256").update(`${context.businessId}:${paymentType}:${context.targetId}`).digest("hex");
  const targetRef = adminDb.collection("payment_checkout_targets").doc(targetKey);
  const reservation = await adminDb.runTransaction(async (tx) => {
    const existing = (await tx.get(targetRef)).data() as AuthorizedCheckout | undefined;
    if (existing && existing.expiresAt > Date.now()) return existing;
    const record: AuthorizedCheckout = { businessId: context.businessId, targetId: context.targetId, paymentType,
      accountId: connect.accountId!, baseCents: amounts.baseCents, feeCents: amounts.feeCents,
      totalCents: amounts.totalCents, currency: "aud", feePayerMode: amounts.feePayerMode,
      token: context.token, reference: context.reference, reservationId: randomUUID(),
      expiresAt: Math.floor(Date.now() / 1000) * 1000 + 35 * 60_000 };
    tx.set(targetRef, record);
    return record;
  });
  if (reservation.accountId !== connect.accountId || reservation.token !== context.token || reservation.baseCents !== amounts.baseCents || reservation.feeCents !== amounts.feeCents || reservation.totalCents !== amounts.totalCents || reservation.feePayerMode !== amounts.feePayerMode) {
    return { ok: false, status: 409, error: "A checkout is already being prepared for this payment. Please try again." };
  }
  if (reservation.sessionId && reservation.url) return { ok: true, sessionId: reservation.sessionId, url: reservation.url };

  const metadata: Record<string, string> = {
    reservationId: reservation.reservationId,
    paymentType,
    token: context.token,
    businessId: context.businessId,
    targetId: context.targetId,
    reference: context.reference,
    feePayerMode: amounts.feePayerMode,
    baseCents: String(amounts.baseCents),
    feeCents: String(amounts.feeCents),
  };

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        expires_at: reservation.expiresAt / 1000,
        payment_method_types: ["card"],
        line_items: lineItems,
        metadata,
        payment_intent_data: { metadata },
        success_url: `${returnBase}?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnBase}?status=cancelled`,
      },
      { stripeAccount: connect.accountId, idempotencyKey: reservation.reservationId },
    );

    if (!session.url) {
      return {
        ok: false,
        status: 502,
        error: "Stripe did not return a checkout URL.",
      };
    }
    const authorized = { ...reservation, sessionId: session.id, url: session.url };
    const batch = adminDb.batch();
    batch.set(adminDb.collection("payment_checkout_sessions").doc(session.id), authorized);
    batch.set(targetRef, authorized);
    await batch.commit();
    return { ok: true, url: session.url, sessionId: session.id };
  } catch (error) {
    console.error("[stripe payment] checkout session failed:", error);
    return {
      ok: false,
      status: 502,
      error: "Could not start the payment. Please try again.",
    };
  }
}
