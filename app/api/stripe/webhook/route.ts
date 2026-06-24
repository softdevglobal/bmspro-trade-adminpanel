import { processStripeWebhookEvent, assertStripeWebhookReady } from "@/lib/stripe/webhook-handlers";
import { getStripe } from "@/lib/stripe/client";
import { isStripeWebhookConfigured } from "@/lib/stripe/config";
import { NextResponse } from "next/server";

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
  const secret = process.env.STRIPE_WEBHOOK_SECRET!.trim();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    console.error("[stripe webhook] signature verification failed:", error);
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
