import "server-only";

import type { BillingCycle } from "@/lib/subscription-plans/types";
import { isStripeConfigured } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";

export type SubscriptionPlanStripeSyncInput = {
  planId: string;
  name: string;
  price: number;
  billingCycle: BillingCycle;
  description?: string | null;
  staff?: number;
  existingStripePriceId?: string | null;
  existingStripeProductId?: string | null;
};

function productDescription(
  input: SubscriptionPlanStripeSyncInput,
): string | undefined {
  const parts: string[] = [];
  if (input.description?.trim()) parts.push(input.description.trim());
  if (
    typeof input.staff === "number" &&
    Number.isFinite(input.staff) &&
    input.staff >= 0
  ) {
    parts.push(`${input.staff} staff included`);
  }
  const text = parts.join(" — ");
  return text ? text.slice(0, 500) : undefined;
}

function recurringInterval(
  billingCycle: BillingCycle,
): { interval: "week" | "month"; interval_count: number } {
  return billingCycle === "monthly"
    ? { interval: "month", interval_count: 1 }
    : { interval: "week", interval_count: 1 };
}

function priceMatchesPlan(
  unitAmount: number,
  billingCycle: BillingCycle,
  existingPrice: {
    active: boolean;
    currency: string;
    unit_amount: number | null;
    recurring: { interval: string; interval_count: number } | null;
  },
): boolean {
  const recurring = recurringInterval(billingCycle);
  return (
    existingPrice.active &&
    existingPrice.currency === "aud" &&
    existingPrice.unit_amount === unitAmount &&
    existingPrice.recurring?.interval === recurring.interval &&
    (existingPrice.recurring?.interval_count ?? 1) === recurring.interval_count
  );
}

/** Creates or updates a Stripe Product + recurring Price for a subscription plan. */
export async function syncSubscriptionPlanStripeLink(
  input: SubscriptionPlanStripeSyncInput,
): Promise<{ stripePriceId: string; stripeProductId: string }> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local.");
  }

  const unitAmount = Math.round(input.price * 100);
  if (!Number.isFinite(unitAmount) || unitAmount < 50) {
    throw new Error("Plan price must be at least AU$0.50 for Stripe.");
  }

  const stripe = getStripe();
  let productId = input.existingStripeProductId?.trim() || null;

  if (!productId) {
    try {
      const search = await stripe.products.search({
        query: `metadata['planId']:'${input.planId}' AND active:'true'`,
        limit: 1,
      });
      productId = search.data[0]?.id ?? null;
    } catch {
      productId = null;
    }
  }

  if (!productId && input.existingStripePriceId) {
    try {
      const existingPrice = await stripe.prices.retrieve(input.existingStripePriceId);
      productId =
        typeof existingPrice.product === "string"
          ? existingPrice.product
          : existingPrice.product?.id ?? null;
    } catch {
      productId = null;
    }
  }

  if (!productId) {
    const product = await stripe.products.create({
      name: input.name.trim(),
      description: productDescription(input),
      metadata: {
        planId: input.planId,
        type: "subscription",
      },
    });
    productId = product.id;
  } else {
    await stripe.products.update(productId, {
      name: input.name.trim(),
      description: productDescription(input),
      metadata: {
        planId: input.planId,
        type: "subscription",
      },
    });
  }

  if (input.existingStripePriceId) {
    try {
      const existingPrice = await stripe.prices.retrieve(input.existingStripePriceId);
      if (priceMatchesPlan(unitAmount, input.billingCycle, existingPrice)) {
        return {
          stripePriceId: input.existingStripePriceId,
          stripeProductId: productId,
        };
      }
    } catch {
      /* create a new price below */
    }
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: "aud",
    recurring: recurringInterval(input.billingCycle),
    metadata: {
      planId: input.planId,
      type: "subscription",
    },
  });

  if (input.existingStripePriceId && input.existingStripePriceId !== price.id) {
    try {
      await stripe.prices.update(input.existingStripePriceId, { active: false });
    } catch {
      /* best effort */
    }
  }

  return { stripePriceId: price.id, stripeProductId: productId };
}
