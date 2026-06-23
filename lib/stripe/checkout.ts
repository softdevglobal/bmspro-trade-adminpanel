import "server-only";

import { getOrCreateStripeCustomerId } from "@/lib/stripe/customers";
import { getAppBaseUrl } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";
import { resolveSmsPackageForCheckout } from "@/lib/sms-packages/server";
import { resolveSubscriptionPlanForCheckout } from "@/lib/subscription-plans/server";

export type CheckoutSessionResult = {
  url: string;
  sessionId: string;
};

function checkoutSuccessUrl(baseUrl: string, path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${baseUrl}${path}${separator}session_id={CHECKOUT_SESSION_ID}`;
}

export async function createSubscriptionCheckoutSession(input: {
  businessId: string;
  planId: string;
  customerEmail?: string | null;
  successPath?: string;
  cancelPath?: string;
}): Promise<CheckoutSessionResult> {
  const plan = await resolveSubscriptionPlanForCheckout(input.planId.trim());

  const stripe = getStripe();

  try {
    const stripePrice = await stripe.prices.retrieve(plan.stripePriceId!);
    if (!stripePrice.recurring) {
      throw new Error(
        "This plan is linked to a one-time Stripe price. Re-save the plan in Packages to create a recurring price.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("one-time")) {
      throw error;
    }
    throw new Error(
      `Stripe price "${plan.stripePriceId}" is invalid or missing. Re-link the plan in Packages.`,
    );
  }

  const baseUrl = getAppBaseUrl();
  const customerId = await getOrCreateStripeCustomerId(
    input.businessId,
    input.customerEmail,
  );

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripePriceId!, quantity: 1 }],
    success_url: checkoutSuccessUrl(
      baseUrl,
      input.successPath ?? "/dashboard?checkout=success",
    ),
    cancel_url: `${baseUrl}${input.cancelPath ?? "/dashboard?checkout=canceled"}`,
    client_reference_id: input.businessId,
    metadata: {
      type: "subscription",
      businessId: input.businessId,
      planId: plan.id,
    },
    subscription_data: {
      metadata: {
        businessId: input.businessId,
        planId: plan.id,
      },
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return { url: session.url, sessionId: session.id };
}

export async function createSmsCheckoutSession(input: {
  businessId: string;
  packageId: string;
  customerEmail?: string | null;
  successPath?: string;
  cancelPath?: string;
}): Promise<CheckoutSessionResult> {
  const pkg = await resolveSmsPackageForCheckout(input.packageId.trim());
  const stripe = getStripe();

  try {
    const stripePrice = await stripe.prices.retrieve(pkg.stripePriceId!);
    if (stripePrice.type === "recurring" || stripePrice.recurring) {
      throw new Error(
        "This SMS package is linked to a recurring Stripe price. Re-save the package in SMS Packages to create a one-time price.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("recurring")) {
      throw error;
    }
    throw new Error(
      `Stripe price "${pkg.stripePriceId}" is invalid or missing. Re-link the package in SMS Packages.`,
    );
  }

  const baseUrl = getAppBaseUrl();
  const customerId = await getOrCreateStripeCustomerId(
    input.businessId,
    input.customerEmail,
  );

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: pkg.stripePriceId!, quantity: 1 }],
    success_url: checkoutSuccessUrl(
      baseUrl,
      input.successPath ?? "/dashboard/sms?checkout=success",
    ),
    cancel_url: `${baseUrl}${input.cancelPath ?? "/dashboard/sms?checkout=canceled"}`,
    client_reference_id: input.businessId,
    metadata: {
      type: "sms_topup",
      businessId: input.businessId,
      smsPackageId: pkg.id,
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  return { url: session.url, sessionId: session.id };
}

export async function createBillingPortalSession(input: {
  businessId: string;
  returnPath?: string;
}): Promise<CheckoutSessionResult> {
  const stripe = getStripe();
  const baseUrl = getAppBaseUrl();
  const customerId = await getOrCreateStripeCustomerId(input.businessId);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}${input.returnPath ?? "/dashboard/settings"}`,
  });

  return { url: session.url, sessionId: session.id };
}
