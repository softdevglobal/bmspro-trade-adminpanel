import type { QuotationDetail } from "@/lib/quotations/types";

/**
 * Quote value totals for the Quotations page summary cards.
 *
 * - Approved: the customer accepted the quote, or it has already become a job
 *   or an invoice (both require acceptance).
 * - Pending: drafts and sent quotes still waiting on the customer — not
 *   approved, not rejected and not cancelled.
 *
 * Cancelled and rejected quotes count in neither. Quotes generated for a
 * direct invoice are skipped: the customer never saw them as a quote, and
 * their value is already on the invoice.
 *
 * The mobile app mirrors these rules in lib/utils/value_summaries.dart.
 */
export type QuotationValueSummary = {
  pendingAud: number;
  pendingCount: number;
  approvedAud: number;
  approvedCount: number;
};

type SummaryQuotation = Pick<
  QuotationDetail,
  | "status"
  | "customerDecision"
  | "bookingId"
  | "invoiceId"
  | "finalPriceAud"
  | "createdSource"
>;

export function isApprovedQuotation(quotation: SummaryQuotation): boolean {
  if (quotation.status === "cancelled") return false;
  if (quotation.createdSource === "invoice_direct") return false;
  return (
    quotation.customerDecision === "accepted" ||
    Boolean(quotation.bookingId) ||
    Boolean(quotation.invoiceId)
  );
}

export function isPendingValueQuotation(quotation: SummaryQuotation): boolean {
  if (quotation.status !== "draft" && quotation.status !== "sent") return false;
  if (quotation.createdSource === "invoice_direct") return false;
  if (quotation.customerDecision === "rejected") return false;
  return !isApprovedQuotation(quotation);
}

function amount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarizeQuotationValues(
  quotations: readonly SummaryQuotation[],
): QuotationValueSummary {
  let pendingAud = 0;
  let pendingCount = 0;
  let approvedAud = 0;
  let approvedCount = 0;
  for (const quotation of quotations) {
    if (isApprovedQuotation(quotation)) {
      approvedAud += amount(quotation.finalPriceAud);
      approvedCount += 1;
    } else if (isPendingValueQuotation(quotation)) {
      pendingAud += amount(quotation.finalPriceAud);
      pendingCount += 1;
    }
  }
  return {
    pendingAud: roundCents(pendingAud),
    pendingCount,
    approvedAud: roundCents(approvedAud),
    approvedCount,
  };
}
