import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type Stripe from "stripe";

import { adminDb } from "@/lib/firebase/admin";
import {
  activateTenantSubscription,
  handleSubscriptionInvoicePaid,
  markTenantSubscriptionCanceled,
} from "@/lib/stripe/billing";
import { getStripe } from "@/lib/stripe/client";
import { isStripeWebhookConfigured } from "@/lib/stripe/config";

const PROCESSED_INVOICES = "stripe_processed_invoices";

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent;
  if (parent?.type === "subscription_details") {
    const sub = parent.subscription_details?.subscription;
    if (typeof sub === "string" && sub.trim()) return sub.trim();
  }

  const legacy = (invoice as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null })
    .subscription;
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  if (legacy && typeof legacy === "object" && "id" in legacy) {
    const id = (legacy as Stripe.Subscription).id;
    if (id?.trim()) return id.trim();
  }

  return null;
}

async function isInvoiceProcessed(invoiceId: string): Promise<boolean> {
  const snap = await adminDb
    .collection(PROCESSED_INVOICES)
    .doc(invoiceId)
    .get();
  return snap.exists;
}

async function markInvoiceProcessed(
  invoiceId: string,
  businessId: string,
  billingReason: string | null,
): Promise<void> {
  await adminDb.collection(PROCESSED_INVOICES).doc(invoiceId).set({
    invoiceId,
    businessId,
    billingReason,
    processedAt: FieldValue.serverTimestamp(),
  });
}

async function resolveBusinessIdFromSubscription(
  subscriptionId: string,
): Promise<string | null> {
  const trimmed = subscriptionId.trim();
  if (!trimmed) return null;

  const snap = await adminDb
    .collection("businesses")
    .where("stripeSubscriptionId", "==", trimmed)
    .limit(1)
    .get();

  if (!snap.empty) return snap.docs[0].id;

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(trimmed);
  const fromMeta =
    typeof subscription.metadata?.businessId === "string"
      ? subscription.metadata.businessId.trim()
      : "";
  return fromMeta || null;
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (invoice.status !== "paid") return;

  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;

  if (await isInvoiceProcessed(invoice.id)) return;

  const businessId = await resolveBusinessIdFromSubscription(subscriptionId);
  if (!businessId) {
    console.warn("[stripe webhook] invoice.paid — no business for subscription", {
      subscriptionId,
      invoiceId: invoice.id,
    });
    return;
  }

  const billingReason = invoice.billing_reason ?? null;
  const ref = adminDb.collection("businesses").doc(businessId);
  const snap = await ref.get();
  const data = snap.data() ?? {};

  if (billingReason === "subscription_cycle") {
    await handleSubscriptionInvoicePaid(businessId);
  } else if (billingReason === "subscription_create") {
    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;
    if (!customerId) return;

    if (data.billing_status !== "active" || data.accountStatus !== "active") {
      const planId =
        typeof data.planId === "string"
          ? data.planId
          : typeof (data.plan as { id?: string } | undefined)?.id === "string"
            ? (data.plan as { id: string }).id
            : null;
      await activateTenantSubscription({
        businessId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        planId,
      });
    }
  } else if (
    billingReason === "subscription_update" ||
    billingReason === "manual"
  ) {
    await handleSubscriptionInvoicePaid(businessId);
  }

  await markInvoiceProcessed(invoice.id, businessId, billingReason);
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const businessId = await resolveBusinessIdFromSubscription(subscription.id);
  if (!businessId) return;
  await markTenantSubscriptionCanceled(businessId);
}

/** Verifies and applies Stripe webhook events (subscription renewals, cancellations). */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}

export function assertStripeWebhookReady(): void {
  if (!isStripeWebhookConfigured()) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
}
