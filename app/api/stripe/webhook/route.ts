import { processStripeWebhookEvent, assertStripeWebhookReady } from "@/lib/stripe/webhook-handlers";
import { getStripe } from "@/lib/stripe/client";
import {
  getStripeWebhookSecrets,
  isStripeWebhookConfigured,
} from "@/lib/stripe/config";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

export const runtime = "nodejs";

/** Stripe webhook — auto-renews subscription billing period on recurring invoice.paid. */
export async function POST(request: Request) {
  if (!isStripeWebhookConfigured()) {
    return NextResponse.json(
      { error: "Stripe webhooks are not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature." }, { status: 400 });
  }

  const body = await request.text();
  const stripe = getStripe();

  // Each configured destination signs with its own secret, so a delivery is
  // authentic if any one of them verifies. Only the last failure is reported —
  // failing against the other secrets is the expected case, not an error.
  let event: Stripe.Event | null = null;
  let lastError: unknown = null;
  for (const secret of getStripeWebhookSecrets()) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!event) {
    console.error("[stripe webhook] signature verification failed:", lastError);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    assertStripeWebhookReady();
    await processStripeWebhookEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe webhook] handler failed:", error);
    return NextResponse.json(
      { error: "Webhook handler failed." },
      { status: 500 },
    );
  }
}
