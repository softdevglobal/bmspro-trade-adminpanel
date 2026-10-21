import type Stripe from "stripe";

export type AuthorizedCheckout = {
  businessId: string; targetId: string; paymentType: "invoice_payment" | "quotation_deposit";
  accountId: string; baseCents: number; feeCents: number; totalCents: number; currency: "aud";
  feePayerMode: "business" | "customer"; token: string; reference: string;
  reservationId: string; expiresAt: number; sessionId?: string; url?: string;
};

export function matchesAuthorizedCheckout(session: Stripe.Checkout.Session, record: AuthorizedCheckout, accountId: string | null) {
  return accountId === record.accountId && session.id === record.sessionId &&
    session.mode === "payment" && session.status === "complete" && session.payment_status === "paid" &&
    record.baseCents > 0 && Number.isSafeInteger(record.baseCents) &&
    session.amount_total === record.totalCents && session.currency === record.currency &&
    session.metadata?.businessId === record.businessId && session.metadata?.targetId === record.targetId &&
    session.metadata?.paymentType === record.paymentType && session.metadata?.reservationId === record.reservationId &&
    session.expires_at * 1000 === record.expiresAt;
}
