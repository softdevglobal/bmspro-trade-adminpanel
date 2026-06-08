import type { QuotationDetail } from "@/lib/quotations/types";

export function quotationHasInvoice(
  quotation: Pick<QuotationDetail, "invoiceId">,
): boolean {
  return Boolean(quotation.invoiceId);
}

/** Job follow-up actions are closed once the booking is completed and invoiced. */
export function quotationJobActionsLocked(quotation: QuotationDetail): boolean {
  if (!quotationHasInvoice(quotation)) return false;
  return (
    quotation.bookingStatus === "completed" || Boolean(quotation.bookingId)
  );
}
