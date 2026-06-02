import { formatAddress, type InspectionAddress } from "@/lib/inspection/types";

/** Line item fields used by the PDF layout and the create-page preview. */
export type QuotationDocumentLineItem = {
  code?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  rateAud: number;
  gstPercent: number;
  /** Line amount excluding GST (after quantity × rate and line discount). */
  amountAud: number;
};

export type QuotationDocumentCustomer = {
  fullName: string;
  email: string;
  phone: string;
};

export type QuotationDocumentBusiness = {
  businessName: string;
  logoUrl: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
  registeredForGst: boolean;
  gstPercentage: number;
};

/** Shared view-model for quotation PDF generation and the admin preview. */
export type QuotationDocumentData = {
  quoteNo: string;
  quoteDate: string;
  validUntil: string | null;
  customer: QuotationDocumentCustomer;
  customerAddress: InspectionAddress;
  lineItems: QuotationDocumentLineItem[];
  subtotalAud: number;
  discountAud: number;
  gstAud: number;
  totalAud: number;
  paymentInstructions: string | null;
  notes: string | null;
  business: QuotationDocumentBusiness;
};

export function formatQuoteMoney(value: number): string {
  return `$${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatQuoteDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export type GstPricingMode = "exclusive" | "inclusive";

/** Converts entered rate/qty/discount to ex-GST line amount and rate for documents. */
export function computeQuotationLineAmounts(input: {
  quantity: number;
  rate: number;
  discountPercent: number;
  gstPercent: number;
  gstPricing: GstPricingMode;
}): { amountAud: number; rateAudExGst: number } {
  const gross =
    Math.round(
      input.quantity *
        input.rate *
        (1 - input.discountPercent / 100) *
        100,
    ) / 100;

  if (input.gstPercent <= 0 || input.gstPricing === "exclusive") {
    const rateAudExGst =
      input.quantity > 0
        ? Math.round((gross / input.quantity) * 100) / 100
        : input.rate;
    return { amountAud: gross, rateAudExGst };
  }

  const amountAud =
    Math.round((gross / (1 + input.gstPercent / 100)) * 100) / 100;
  const rateAudExGst =
    input.quantity > 0
      ? Math.round((amountAud / input.quantity) * 100) / 100
      : input.rate;
  return { amountAud, rateAudExGst };
}

export function computeDocumentTotals(input: {
  lineItems: QuotationDocumentLineItem[];
  discountAud: number;
}): { subtotalAud: number; gstAud: number; totalAud: number } {
  const subtotalAud = input.lineItems.reduce(
    (sum, item) => sum + item.amountAud,
    0,
  );
  const discountAud = Math.max(0, input.discountAud);
  const afterDiscount = Math.max(0, subtotalAud - discountAud);

  const taxableSubtotal = input.lineItems.reduce((sum, item) => {
    if (item.gstPercent <= 0) return sum;
    return sum + item.amountAud;
  }, 0);

  const taxableAfterDiscount =
    subtotalAud > 0 ? (taxableSubtotal / subtotalAud) * afterDiscount : 0;

  const gstAud =
    Math.round(
      input.lineItems.reduce((sum, item) => {
        if (item.gstPercent <= 0 || subtotalAud <= 0) return sum;
        const share = item.amountAud / subtotalAud;
        const lineAfterDiscount = afterDiscount * share;
        return sum + lineAfterDiscount * (item.gstPercent / 100);
      }, 0) * 100,
    ) / 100;

  void taxableAfterDiscount;

  return {
    subtotalAud,
    gstAud,
    totalAud: Math.round((afterDiscount + gstAud) * 100) / 100,
  };
}

export function buildCustomerAddressLine(address: InspectionAddress): string {
  return formatAddress(address);
}
