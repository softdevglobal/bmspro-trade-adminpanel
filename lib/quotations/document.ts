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

export type QuotationDocumentDeposit = {
  amountAud: number;
  dueDate: string;
  balanceDueAud: number;
  mode: "percent" | "fixed";
  percent: number;
};

/** Shared view-model for quotation PDF generation and the admin preview. */
export type QuotationDocumentData = {
  quoteNo: string;
  quoteDate: string;
  validUntil: string | null;
  serviceTitle: string | null;
  customer: QuotationDocumentCustomer;
  customerAddress: InspectionAddress;
  lineItems: QuotationDocumentLineItem[];
  subtotalAud: number;
  discountAud: number;
  gstAud: number;
  totalAud: number;
  deposit: QuotationDocumentDeposit | null;
  termsAndConditions: string | null;
  paymentInstructions: string | null;
  notes: string | null;
  business: QuotationDocumentBusiness;
};

export function buildQuotationDocumentDeposit(
  totalAud: number,
  deposit:
    | {
        amountAud: number;
        dueDate: string;
        mode?: "percent" | "fixed";
        percent?: number;
      }
    | null
    | undefined,
): QuotationDocumentDeposit | null {
  if (!deposit || deposit.amountAud <= 0 || !deposit.dueDate.trim()) {
    return null;
  }
  const amountAud = Math.min(
    Math.round(deposit.amountAud * 100) / 100,
    Math.max(0, totalAud),
  );
  if (amountAud <= 0) return null;
  return {
    amountAud,
    dueDate: deposit.dueDate.trim(),
    balanceDueAud: Math.max(
      0,
      Math.round((totalAud - amountAud) * 100) / 100,
    ),
    mode: deposit.mode === "percent" ? "percent" : "fixed",
    percent:
      typeof deposit.percent === "number" && Number.isFinite(deposit.percent)
        ? deposit.percent
        : 0,
  };
}

export function formatDepositSummary(deposit: QuotationDocumentDeposit): string {
  const due = formatQuoteDate(deposit.dueDate);
  if (deposit.mode === "percent" && deposit.percent > 0) {
    return `${deposit.percent}% deposit · due ${due}`;
  }
  return `Due ${due}`;
}

/** True when a stored attachment URL points to a PDF file. */
export function isPdfAttachmentUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return (
    normalized.includes(".pdf?") ||
    normalized.endsWith(".pdf") ||
    normalized.includes("%2fpdf%3f") ||
    normalized.includes("/pdf?")
  );
}

/** Best-effort display name from a Firebase Storage attachment URL. */
export function attachmentDisplayName(url: string): string {
  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/\/([^/?]+)\?/);
    if (match?.[1]) {
      const name = match[1].replace(/^\d+-[a-f0-9-]+\./i, "");
      return name || "Attachment";
    }
  } catch {
    /* fall through */
  }
  return isPdfAttachmentUrl(url) ? "Document.pdf" : "Photo";
}

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

export function resolveQuotationTerms(input: {
  termsAndConditions?: string | null;
  paymentInstructions?: string | null;
}): string | null {
  if (input.termsAndConditions?.trim()) return input.termsAndConditions.trim();
  if (input.paymentInstructions?.trim()) return input.paymentInstructions.trim();
  return null;
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
