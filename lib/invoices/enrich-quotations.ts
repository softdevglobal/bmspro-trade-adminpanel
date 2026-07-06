import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { InvoiceStatus } from "@/lib/invoices/types";
import type { QuotationDetail } from "@/lib/quotations/types";

/** Attaches linked invoice metadata when an invoice doc exists (id = quotation id). */
export async function enrichQuotationsWithInvoices(
  quotations: QuotationDetail[],
): Promise<QuotationDetail[]> {
  if (quotations.length === 0) return quotations;

  const refs = quotations.map((quotation) =>
    adminDb.collection("invoices").doc(quotation.id),
  );
  const snaps = await adminDb.getAll(...refs);
  const invoiceByQuotationId = new Map(
    snaps
      .filter((snap) => snap.exists)
      .map((snap) => [snap.id, snap.data() ?? {}] as const),
  );

  return quotations.map((quotation) => {
    const invoice = invoiceByQuotationId.get(quotation.id);
    if (!invoice) return quotation;

    const invoiceStatus: InvoiceStatus =
      invoice.status === "paid"
        ? "paid"
        : invoice.status === "sent"
          ? "sent"
          : invoice.status === "cancelled"
            ? "cancelled"
            : "draft";

    return {
      ...quotation,
      invoiceId: quotation.id,
      invoiceCode:
        typeof invoice.invoiceCode === "string" ? invoice.invoiceCode : null,
      invoiceStatus,
      invoicePdfUrl:
        typeof invoice.pdfUrl === "string" && invoice.pdfUrl.trim()
          ? invoice.pdfUrl.trim()
          : null,
    };
  });
}
