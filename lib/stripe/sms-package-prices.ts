import "server-only";

import { isStripeConfigured } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";

export type SmsPackageStripeSyncInput = {
  packageId: string;
  name: string;
  price: number;
  description?: string | null;
  messageQuota?: number;
  existingStripePriceId?: string | null;
  existingStripeProductId?: string | null;
};

function productDescription(input: SmsPackageStripeSyncInput): string | undefined {
  const parts: string[] = [];
  if (input.description?.trim()) parts.push(input.description.trim());
  if (
    typeof input.messageQuota === "number" &&
    Number.isFinite(input.messageQuota) &&
    input.messageQuota >= 0
  ) {
    parts.push(`${input.messageQuota.toLocaleString()} SMS messages`);
  }
  const text = parts.join(" — ");
  return text ? text.slice(0, 500) : undefined;
}

/** Creates or updates a Stripe Product + one-time Price for an SMS package. */
export async function syncSmsPackageStripeLink(
  input: SmsPackageStripeSyncInput,
): Promise<{ stripePriceId: string; stripeProductId: string }> {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local.");
  }

  const unitAmount = Math.round(input.price * 100);
  if (!Number.isFinite(unitAmount) || unitAmount < 50) {
    throw new Error("SMS package price must be at least AU$0.50 for Stripe.");
  }

  const stripe = getStripe();
  let productId = input.existingStripeProductId?.trim() || null;

  if (!productId) {
    try {
      const search = await stripe.products.search({
        query: `metadata['smsPackageId']:'${input.packageId}' AND active:'true'`,
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
        smsPackageId: input.packageId,
        type: "sms_topup",
      },
    });
    productId = product.id;
  } else {
    await stripe.products.update(productId, {
      name: input.name.trim(),
      description: productDescription(input),
      metadata: {
        smsPackageId: input.packageId,
        type: "sms_topup",
      },
    });
  }

  if (input.existingStripePriceId) {
    try {
      const existingPrice = await stripe.prices.retrieve(input.existingStripePriceId);
      if (
        existingPrice.active &&
        existingPrice.currency === "aud" &&
        existingPrice.unit_amount === unitAmount
      ) {
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
    metadata: {
      smsPackageId: input.packageId,
      type: "sms_topup",
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
