import "server-only";

import type { InvoiceDetail } from "@/lib/invoices/types";
import { getBusinessProfile } from "@/lib/onboarding/server";
import type { QuotationDetail } from "@/lib/quotations/types";
import { getAppBaseUrl } from "@/lib/stripe/config";
import {
  getOrCreatePaymentLink,
  paymentLinkPath,
} from "@/lib/stripe/payment-links";

/** True when the business can actually accept online card payments. */
async function isBusinessPaymentReady(businessId: string): Promise<boolean> {
  const profile = await getBusinessProfile(businessId);
  return Boolean(
    profile?.stripeConnectAccountId && profile?.stripeConnectOnboarded,
  );
}

/**
 * Returns the public pay URL for a quotation deposit, or `null` when there is
 * nothing to pay online (no deposit, already paid, cancelled, or the business
 * has not connected Stripe). The link token is stable and reused per document.
 */
export async function resolveQuotationPayUrl(
  businessId: string,
  quotation: QuotationDetail,
  connectedHint?: boolean,
): Promise<string | null> {
  const deposit = quotation.depositRequest;
  const amountAud = deposit?.amountAud ?? 0;
  if (!deposit || amountAud <= 0) return null;
  if (quotation.status === "cancelled") return null;
  if (quotation.depositPayment?.status === "paid" || deposit.paid === true) {
    return null;
  }

  try {
    const connected =
      connectedHint ?? (await isBusinessPaymentReady(businessId));
    if (!connected) return null;

    const link = await getOrCreatePaymentLink({
      type: "quotation",
      businessId,
      targetId: quotation.id,
    });
    return `${getAppBaseUrl()}${paymentLinkPath(link)}`;
  } catch (error) {
    console.error("[payments] quotation pay link resolution failed:", error);
    return null;
  }
}

/**
 * Returns the public pay URL for an invoice balance, or `null` when nothing is
 * owed / the invoice is not in a payable state / Stripe is not connected.
 */
export async function resolveInvoicePayUrl(
  businessId: string,
  invoice: InvoiceDetail,
  connectedHint?: boolean,
): Promise<string | null> {
  if (invoice.balanceDueAud <= 0) return null;
  if (invoice.status !== "sent") return null;

  try {
    const connected =
      connectedHint ?? (await isBusinessPaymentReady(businessId));
    if (!connected) return null;

    const link = await getOrCreatePaymentLink({
      type: "invoice",
      businessId,
      targetId: invoice.id,
    });
    return `${getAppBaseUrl()}${paymentLinkPath(link)}`;
  } catch (error) {
    console.error("[payments] invoice pay link resolution failed:", error);
    return null;
  }
}
