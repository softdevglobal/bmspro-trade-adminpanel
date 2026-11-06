import "server-only";

import { createInvoiceFromQuotation } from "@/lib/invoices/server";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { platformTodayIso } from "@/lib/platform/timezone";
import { computeDocumentTotals, formatDepositPaymentNote, resolveDocumentLineFromQuotationItem } from "@/lib/quotations/document";
import { getBusinessQuotationById } from "@/lib/quotations/server";

export async function draftAcceptedQuotationInvoice(businessId: string, quotationId: string) {
  const quotation = await getBusinessQuotationById(businessId, quotationId);
  if (!quotation || quotation.status !== "sent" || quotation.customerDecision !== "accepted") {
    return { status: "REJECTED", message: "No accepted quotation was found for this business." };
  }

  if (quotation.invoiceId) return { status: "ALREADY_EXISTS", invoiceId: quotation.invoiceId };

  const profile = await getBusinessProfile(businessId);
  const invoiceDate = platformTodayIso(new Date(), profile?.timezone);
  const due = new Date(`${invoiceDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 14);
  const deposit = quotation.depositRequest;
  const depositPayment = quotation.depositPayment;
  const terms = quotation.termsAndConditions || quotation.paymentInstructions;
  const { gstAud } = computeDocumentTotals({
    lineItems: quotation.lineItems.map((item) => resolveDocumentLineFromQuotationItem(item, 0)),
    discountAud: quotation.discountAud,
    gstPricing: quotation.gstPricing,
  });

  const result = await createInvoiceFromQuotation(businessId, { uid: "trade-invoice-automation" }, {
    quotationId,
    lineItems: quotation.lineItems,
    finalPriceAud: quotation.finalPriceAud,
    discountAud: quotation.discountAud,
    gstPricing: quotation.gstPricing,
    gstAud,
    notes: quotation.notes,
    termsAndConditions: deposit ? terms?.replace(formatDepositPaymentNote(deposit), "").trim() : terms,
    depositRequest: depositPayment && deposit
      ? { ...deposit, mode: "fixed", amountAud: depositPayment.amountAud, paid: true }
      : deposit,
    invoiceDate,
    dueDate: due.toISOString().slice(0, 10),
  }, { acceptedQuotationUpdatedAt: quotation.updatedAt });

  if (!result.ok) return { status: "REJECTED", message: result.error };
  return { status: "DRAFT", invoiceId: result.invoice.id, invoiceCode: result.invoice.invoiceCode };
}
