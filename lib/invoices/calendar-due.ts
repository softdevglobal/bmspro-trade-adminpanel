/**
 * Invoice due dates for the calendar: the days the business has money to
 * collect.
 *
 * Only issued invoices with an amount still owed appear. Drafts are not owed
 * yet, and paid or cancelled invoices have nothing left to collect, so showing
 * them would put dates on the calendar that need no action.
 */

import type { InvoiceDetail } from "@/lib/invoices/types";
import { resolveInvoicePaymentDue } from "@/lib/invoices/payment-due";

export type InvoiceDueItem = {
  invoiceId: string;
  invoiceCode: string;
  /** Due date, `YYYY-MM-DD`. */
  date: string;
  customerName: string;
  serviceTitle: string;
  /** Amount still owed. */
  outstandingAud: number;
  /** Total of the invoice. */
  totalAud: number;
  isOverdue: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function invoiceDueItems(
  invoices: readonly InvoiceDetail[],
  timeZone?: string | null,
  now = new Date(),
): InvoiceDueItem[] {
  const items: InvoiceDueItem[] = [];
  for (const invoice of invoices) {
    const date = invoice.dueDate?.trim() ?? "";
    if (!ISO_DATE.test(date)) continue;
    const due = resolveInvoicePaymentDue(invoice, timeZone, now);
    if (!due.isPayable) continue;
    items.push({
      invoiceId: invoice.id,
      invoiceCode: invoice.invoiceCode,
      date,
      customerName: invoice.customer?.fullName?.trim() ?? "",
      serviceTitle: invoice.serviceTitle?.trim() ?? "",
      outstandingAud: due.outstandingAud,
      totalAud: invoice.finalPriceAud,
      isOverdue: due.isOverdue,
    });
  }
  return items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.invoiceCode.localeCompare(b.invoiceCode),
  );
}

/** Total still to collect across [items]. */
export function totalOutstandingAud(items: readonly InvoiceDueItem[]): number {
  const cents = items.reduce(
    (sum, item) => sum + Math.round(item.outstandingAud * 100),
    0,
  );
  return cents / 100;
}

/** Invoices page link that opens this invoice's preview. */
export function invoiceDueHref(item: InvoiceDueItem): string {
  const filter = item.isOverdue ? "filter=overdue&" : "";
  return `/dashboard/invoices?${filter}view=${encodeURIComponent(item.invoiceId)}`;
}
