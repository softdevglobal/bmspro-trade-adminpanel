import "server-only";

/** Who covers the Stripe processing fee for customer payments. */
export type FeePayerMode = "business" | "customer";

export function parseFeePayerMode(raw: unknown): FeePayerMode {
  return raw === "customer" ? "customer" : "business";
}

export type ProcessingFeeConfig = {
  /** Percentage rate, e.g. 2.9 means 2.9%. */
  percent: number;
  /** Fixed component in cents, e.g. 30 means A$0.30. */
  fixedCents: number;
};

/**
 * Current Stripe processing fee structure, configurable via env so it can be
 * kept in step with the connected account's real pricing. Defaults to the
 * blueprint's AU standard card rate (2.9% + A$0.30).
 */
export function getProcessingFeeConfig(): ProcessingFeeConfig {
  const percentRaw = Number.parseFloat(process.env.STRIPE_FEE_PERCENT ?? "");
  const fixedRaw = Number.parseInt(process.env.STRIPE_FEE_FIXED_CENTS ?? "", 10);
  const percent =
    Number.isFinite(percentRaw) && percentRaw >= 0 && percentRaw < 100
      ? percentRaw
      : 2.9;
  const fixedCents =
    Number.isFinite(fixedRaw) && fixedRaw >= 0 ? fixedRaw : 30;
  return { percent, fixedCents };
}

export type PaymentAmounts = {
  feePayerMode: FeePayerMode;
  currency: "aud";
  /** Amount owed to the business (invoice / deposit amount). */
  baseCents: number;
  /** Processing fee added on top (0 when the business absorbs it). */
  feeCents: number;
  /** Amount actually charged to the customer. */
  totalCents: number;
  baseAud: number;
  feeAud: number;
  totalAud: number;
};

/**
 * Computes the amount to charge a customer for a given base amount.
 *
 * - `business`: customer pays exactly the base amount; Stripe deducts its fee
 *   from the connected account, so the business nets base − fee.
 * - `customer`: the base amount is grossed up so that, after Stripe's fee, the
 *   business still receives the full base amount.
 *
 * Gross-up formula (per blueprint):
 *   gross = round((base + fixed) / (1 − rate))
 *
 * This is the single source of truth for payment amounts and must only ever run
 * on the backend — amounts are never trusted from the client.
 */
export function computePaymentAmounts(input: {
  baseAud: number;
  feePayerMode: FeePayerMode;
}): PaymentAmounts {
  const baseCents = Math.max(0, Math.round(input.baseAud * 100));
  const config = getProcessingFeeConfig();

  let feeCents = 0;
  if (input.feePayerMode === "customer" && baseCents > 0) {
    const rate = config.percent / 100;
    const grossCents = Math.round((baseCents + config.fixedCents) / (1 - rate));
    feeCents = Math.max(0, grossCents - baseCents);
  }

  const totalCents = baseCents + feeCents;
  return {
    feePayerMode: input.feePayerMode,
    currency: "aud",
    baseCents,
    feeCents,
    totalCents,
    baseAud: baseCents / 100,
    feeAud: feeCents / 100,
    totalAud: totalCents / 100,
  };
}
