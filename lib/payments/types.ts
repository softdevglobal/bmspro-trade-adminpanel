import type { FeePayerMode } from "@/lib/stripe/fees";

export type PaymentLinkType = "quotation" | "invoice";

/** A settled Stripe payment against a quotation deposit or an invoice. */
export type StripePaymentRecord = {
  kind: "quotation_deposit" | "invoice_payment";
  /** Amount credited to the business (deposit / invoice amount). */
  amountAud: number;
  /** Processing fee the customer paid on top (0 when the business absorbs it). */
  feeAud: number;
  /** Total amount charged to the customer's card. */
  totalChargedAud: number;
  feePayerMode: FeePayerMode;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeConnectedAccountId: string | null;
  currency: "aud";
  /** Epoch milliseconds when the payment completed. */
  paidAt: number;
};

/** Deposit payment summary stored on a quotation document. */
export type DepositPaymentRecord = {
  status: "paid";
  amountAud: number;
  feeAud: number;
  totalChargedAud: number;
  feePayerMode: FeePayerMode;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  paidAt: number | null;
};

/** One payment entry in an invoice's payment history. */
export type InvoicePaymentEntry = {
  amountAud: number;
  feeAud: number;
  totalChargedAud: number;
  feePayerMode: FeePayerMode;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  paidAt: number | null;
};

export function parseDepositPaymentRecord(
  raw: unknown,
): DepositPaymentRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (data.status !== "paid") return null;
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const toMillis = (value: unknown): number | null => {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "toMillis" in value) {
      try {
        return (value as { toMillis: () => number }).toMillis();
      } catch {
        return null;
      }
    }
    return null;
  };
  return {
    status: "paid",
    amountAud: num(data.amountAud),
    feeAud: num(data.feeAud),
    totalChargedAud: num(data.totalChargedAud),
    feePayerMode: data.feePayerMode === "customer" ? "customer" : "business",
    stripeCheckoutSessionId:
      typeof data.stripeCheckoutSessionId === "string"
        ? data.stripeCheckoutSessionId
        : null,
    stripePaymentIntentId:
      typeof data.stripePaymentIntentId === "string"
        ? data.stripePaymentIntentId
        : null,
    paidAt: toMillis(data.paidAt),
  };
}

export function parseInvoicePaymentEntries(raw: unknown): InvoicePaymentEntry[] {
  if (!Array.isArray(raw)) return [];
  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const toMillis = (value: unknown): number | null => {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "toMillis" in value) {
      try {
        return (value as { toMillis: () => number }).toMillis();
      } catch {
        return null;
      }
    }
    return null;
  };
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      return {
        amountAud: num(item.amountAud),
        feeAud: num(item.feeAud),
        totalChargedAud: num(item.totalChargedAud),
        feePayerMode: item.feePayerMode === "customer" ? "customer" : "business",
        stripeCheckoutSessionId:
          typeof item.stripeCheckoutSessionId === "string"
            ? item.stripeCheckoutSessionId
            : null,
        stripePaymentIntentId:
          typeof item.stripePaymentIntentId === "string"
            ? item.stripePaymentIntentId
            : null,
        paidAt: toMillis(item.paidAt),
      } satisfies InvoicePaymentEntry;
    })
    .filter((entry): entry is InvoicePaymentEntry => entry !== null);
}
