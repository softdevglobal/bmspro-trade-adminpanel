import type { QuotationDetail } from "@/lib/quotations/types";

export function quotationHasInvoice(
  quotation: Pick<QuotationDetail, "invoiceId">,
): boolean {
  return Boolean(quotation.invoiceId);
}

export function canCancelQuotation(
  quotation: Pick<QuotationDetail, "status" | "invoiceId" | "bookingStatus">,
): boolean {
  return (
    quotation.status !== "cancelled" &&
    quotation.bookingStatus !== "completed" &&
    !quotationHasInvoice(quotation)
  );
}

/** Job follow-up actions are closed once the booking is completed and invoiced. */
export function quotationJobActionsLocked(quotation: QuotationDetail): boolean {
  if (!quotationHasInvoice(quotation)) return false;
  return (
    quotation.bookingStatus === "completed" || Boolean(quotation.bookingId)
  );
}

/**
 * A sent quotation cannot be converted into a job or an invoice until the
 * customer has accepted it.
 */
export function quotationAwaitingCustomerAcceptance(
  quotation: Pick<
    QuotationDetail,
    "status" | "bookingId" | "customerDecision"
  >,
): boolean {
  if (quotation.status !== "sent") return false;
  if (quotation.bookingId) return false;
  return quotation.customerDecision !== "accepted";
}
