import "server-only";

import { getBusinessInvoiceByQuotationId } from "@/lib/invoices/server";
import { getBusinessQuotationById } from "@/lib/quotations/server";
import {
  computePaymentAmounts,
  type FeePayerMode,
  type PaymentAmounts,
} from "@/lib/stripe/fees";
import { resolvePaymentLink } from "@/lib/stripe/payment-links";
import { getBusinessProfile } from "@/lib/onboarding/server";

export type PublicBusinessInfo = {
  name: string;
  logoUrl: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type PublicPaymentContext = {
  token: string;
  type: "quotation" | "invoice";
  businessId: string;
  targetId: string;
  /** Quotation or invoice code shown to the customer. */
  reference: string;
  /** Human label for what is being paid (e.g. "Deposit for QUO-1042"). */
  title: string;
  customerName: string;
  business: PublicBusinessInfo;
  feePayerMode: FeePayerMode;
  /** Server-computed amounts — never trust the client for these. */
  amounts: PaymentAmounts;
  alreadyPaid: boolean;
  paidAt: number | null;
  paymentReference: string | null;
  /** True when a Checkout session may be created for this link. */
  canPay: boolean;
  /** Reason a payment cannot proceed (when `canPay` is false and unpaid). */
  disabledReason: string | null;
};

/**
 * Validates a secure payment token and returns everything the public payment
 * page (and the checkout-session route) needs. All monetary amounts are
 * computed here on the server from stored records.
 */
export async function getPublicPaymentContext(
  token: string,
): Promise<PublicPaymentContext | null> {
  const link = await resolvePaymentLink(token);
  if (!link) return null;

  const profile = await getBusinessProfile(link.businessId);
  if (!profile) return null;

  const business: PublicBusinessInfo = {
    name: profile.businessName ?? "Business",
    logoUrl: profile.logoUrl,
    email: profile.businessEmail,
    phone: profile.businessPhone,
    address: profile.businessAddress,
  };
  const feePayerMode = profile.feePayerMode;
  const connected = Boolean(
    profile.stripeConnectAccountId && profile.stripeConnectOnboarded,
  );

  if (link.type === "quotation") {
    const quotation = await getBusinessQuotationById(
      link.businessId,
      link.targetId,
    );
    if (!quotation) return null;

    const deposit = quotation.depositRequest;
    const baseAud = deposit?.amountAud ?? 0;
    const alreadyPaid =
      quotation.depositPayment?.status === "paid" || deposit?.paid === true;
    const amounts = computePaymentAmounts({ baseAud, feePayerMode });
    const reference = quotation.quotationCode ?? "Quotation";

    let disabledReason: string | null = null;
    if (!deposit || baseAud <= 0) {
      disabledReason = "No deposit is required for this quotation.";
    } else if (quotation.status === "cancelled") {
      disabledReason = "This quotation has been cancelled.";
    } else if (!connected) {
      disabledReason =
        "This business is not ready to accept online payments yet.";
    }

    return {
      token,
      type: "quotation",
      businessId: link.businessId,
      targetId: link.targetId,
      reference,
      title: `Deposit for ${reference}`,
      customerName: quotation.customer.fullName || "Customer",
      business,
      feePayerMode,
      amounts,
      alreadyPaid,
      paidAt: quotation.depositPayment?.paidAt ?? null,
      paymentReference:
        quotation.depositPayment?.stripePaymentIntentId ?? null,
      canPay: !alreadyPaid && !disabledReason && baseAud > 0,
      disabledReason: alreadyPaid ? null : disabledReason,
    };
  }

  const invoice = await getBusinessInvoiceByQuotationId(
    link.businessId,
    link.targetId,
  );
  if (!invoice) return null;

  const baseAud = invoice.balanceDueAud;
  const alreadyPaid = invoice.status === "paid" || baseAud <= 0;
  const amounts = computePaymentAmounts({ baseAud, feePayerMode });
  const reference = invoice.invoiceCode || "Invoice";
  const lastPayment =
    invoice.payments.length > 0
      ? invoice.payments[invoice.payments.length - 1]
      : null;

  let disabledReason: string | null = null;
  if (invoice.status === "cancelled") {
    disabledReason = "This invoice has been cancelled.";
  } else if (invoice.status === "draft") {
    disabledReason = "This invoice is not ready for payment yet.";
  } else if (!connected) {
    disabledReason =
      "This business is not ready to accept online payments yet.";
  }

  return {
    token,
    type: "invoice",
    businessId: link.businessId,
    targetId: link.targetId,
    reference,
    title: `Invoice ${reference}`,
    customerName: invoice.customer.fullName || "Customer",
    business,
    feePayerMode,
    amounts,
    alreadyPaid,
    paidAt: alreadyPaid ? (lastPayment?.paidAt ?? null) : null,
    paymentReference: lastPayment?.stripePaymentIntentId ?? null,
    canPay: !alreadyPaid && !disabledReason && baseAud > 0,
    disabledReason: alreadyPaid ? null : disabledReason,
  };
}
