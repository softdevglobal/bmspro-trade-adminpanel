/**
 * What an invoice actually owes, and when.
 *
 * A due date only means something once the invoice has been issued. Drafts
 * are not yet owed, and paid or cancelled invoices are settled — showing
 * "Due <date>" on any of those misrepresents the state.
 */

import type { InvoiceDetail } from "@/lib/invoices/types";
import { isIsoDateBeforeToday } from "@/lib/platform/timezone";

export type InvoicePaymentDue = {
  /** True only for an issued invoice that still has money outstanding. */
  isPayable: boolean;
  /** True when a payable invoice's due date has already passed. */
  isOverdue: boolean;
  /** Amount still owed. Zero unless the invoice is payable. */
  outstandingAud: number;
  /**
   * Short status for the card footer, e.g. "Due 10/09/2026", "Overdue",
   * "Not issued yet", "Paid". Never claims a due date the invoice does not have.
   */
  label: string;
};

/**
 * Money still owed on an issued invoice, after any paid deposit and any
 * Stripe payments already settled against it.
 */
export function outstandingAmountAud(invoice: InvoiceDetail): number {
  // `balanceDueAud` already nets off a *paid* deposit; payments settle the rest.
  const outstanding = invoice.balanceDueAud - (invoice.amountPaidAud || 0);
  return Math.round(Math.max(0, outstanding) * 100) / 100;
}

export function resolveInvoicePaymentDue(
  invoice: InvoiceDetail,
  timeZone?: string | null,
  now = new Date(),
): InvoicePaymentDue {
  if (invoice.status === "cancelled") {
    return {
      isPayable: false,
      isOverdue: false,
      outstandingAud: 0,
      label: "Cancelled",
    };
  }

  if (invoice.status === "paid") {
    return {
      isPayable: false,
      isOverdue: false,
      outstandingAud: 0,
      label: "Paid",
    };
  }

  if (invoice.status === "draft") {
    // A draft has not been issued, so nothing is owed and no date applies.
    return {
      isPayable: false,
      isOverdue: false,
      outstandingAud: 0,
      label: "Not issued yet",
    };
  }

  // Issued ("sent").
  const outstandingAud = outstandingAmountAud(invoice);
  if (outstandingAud <= 0) {
    return {
      isPayable: false,
      isOverdue: false,
      outstandingAud: 0,
      label: "No amount due",
    };
  }

  const isOverdue = isIsoDateBeforeToday(invoice.dueDate, timeZone, now);
  return {
    isPayable: true,
    isOverdue,
    outstandingAud,
    label: isOverdue ? "Overdue" : "Due",
  };
}
