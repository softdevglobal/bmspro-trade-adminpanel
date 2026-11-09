import { outstandingAmountAud } from "@/lib/invoices/payment-due";
import type { InvoiceDetail } from "@/lib/invoices/types";

/**
 * Invoice value totals for the Invoices page summary cards. Only issued
 * invoices count; drafts are not owed yet and cancelled ones are void.
 *
 * - Paid: money received — the full total of paid invoices, plus deposits
 *   and part-payments already received on invoices that are still open.
 * - Unpaid: what is still owed on issued invoices (the same figure as the
 *   "outstanding" amount on each invoice card).
 *
 * Paid + Unpaid equals the total of all issued invoices.
 * The mobile app mirrors these rules in lib/utils/value_summaries.dart.
 */
export type InvoiceValueSummary = {
  paidAud: number;
  paidCount: number;
  unpaidAud: number;
  unpaidCount: number;
};

type SummaryInvoice = Pick<
  InvoiceDetail,
  "status" | "finalPriceAud" | "balanceDueAud" | "amountPaidAud"
>;

function amount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Money received so far (paid in full, or deposits/part-payments). */
export function receivedInvoiceAud(invoice: SummaryInvoice): number {
  if (invoice.status === "paid") return amount(invoice.finalPriceAud);
  if (invoice.status !== "sent") return 0;
  const total = amount(invoice.finalPriceAud);
  return roundCents(total - Math.min(total, outstandingAmountAud(invoice)));
}

/** Invoices that make up the Paid Invoice Value card. */
export function isPaidValueInvoice(invoice: SummaryInvoice): boolean {
  return receivedInvoiceAud(invoice) > 0;
}

/** Invoices that make up the Unpaid Invoice Value card. */
export function isUnpaidValueInvoice(invoice: SummaryInvoice): boolean {
  return invoice.status === "sent" && outstandingAmountAud(invoice) > 0;
}

export function summarizeInvoiceValues(
  invoices: readonly SummaryInvoice[],
): InvoiceValueSummary {
  let paidAud = 0;
  let paidCount = 0;
  let unpaidAud = 0;
  let unpaidCount = 0;
  for (const invoice of invoices) {
    if (invoice.status === "paid") {
      paidAud += amount(invoice.finalPriceAud);
      paidCount += 1;
    } else if (invoice.status === "sent") {
      const total = amount(invoice.finalPriceAud);
      const outstanding = Math.min(total, outstandingAmountAud(invoice));
      paidAud += total - outstanding;
      unpaidAud += outstanding;
      if (outstanding > 0) unpaidCount += 1;
    }
  }
  return {
    paidAud: roundCents(paidAud),
    paidCount,
    unpaidAud: roundCents(unpaidAud),
    unpaidCount,
  };
}
