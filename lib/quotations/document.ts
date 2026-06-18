import { formatAddress, type InspectionAddress } from "@/lib/inspection/types";
import type { QuotationLineItem } from "@/lib/quotations/types";

/** Line item fields used by the PDF layout and the create-page preview. */
export type QuotationDocumentLineItem = {
  code?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  rateAud: number;
  discountPercent: number;
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
  /** Invoices only: true when the deposit has already been received. */
  paid: boolean;
};

/** Shared view-model for quotation PDF generation and the admin preview. */
export type QuotationDocumentData = {
  quoteNo: string;
  quoteDate: string;
  validUntil: string | null;
  serviceTitle: string | null;
  serviceDescription?: string | null;
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
        paid?: boolean;
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
    paid: deposit.paid === true,
  };
}

export function formatDepositSummary(deposit: QuotationDocumentDeposit): string {
  if (deposit.paid) {
    return deposit.mode === "percent" && deposit.percent > 0
      ? `${deposit.percent}% deposit · received`
      : "Received — thank you";
  }
  const due = formatQuoteDate(deposit.dueDate);
  if (deposit.mode === "percent" && deposit.percent > 0) {
    return `${deposit.percent}% deposit · due ${due}`;
  }
  return `Due ${due}`;
}

/** Human-readable deposit line for terms, invoices, and payment notes. */
export function formatDepositPaymentNote(deposit: {
  mode: "percent" | "fixed";
  percent: number;
  amountAud: number;
  dueDate: string;
  paid?: boolean;
}): string {
  const amount = deposit.amountAud.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const basis =
    deposit.mode === "percent" && deposit.percent > 0
      ? `${deposit.percent}% deposit`
      : "Deposit";
  if (deposit.paid) {
    return `${basis}: $${amount} received — deducted from the balance due.`;
  }
  const due = formatQuoteDate(deposit.dueDate);
  return `${basis}: $${amount} due by ${due}.`;
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

/** Dollar value of a line-level discount (ex-GST). */
export function lineItemDiscountAud(item: QuotationDocumentLineItem): number {
  if (item.discountPercent <= 0) return 0;
  const gross = Math.round(item.rateAud * item.quantity * 100) / 100;
  return Math.max(0, Math.round((gross - item.amountAud) * 100) / 100);
}

export function totalLineDiscountAud(
  lineItems: QuotationDocumentLineItem[],
): number {
  return Math.round(
    lineItems.reduce((sum, item) => sum + lineItemDiscountAud(item), 0) * 100,
  ) / 100;
}

export function grossSubtotalAud(
  lineItems: QuotationDocumentLineItem[],
): number {
  return Math.round(
    lineItems.reduce(
      (sum, item) => sum + item.rateAud * item.quantity,
      0,
    ) * 100,
  ) / 100;
}

export function formatLineDiscountLabel(item: QuotationDocumentLineItem): string {
  const amount = lineItemDiscountAud(item);
  if (item.discountPercent <= 0 || amount <= 0) return "—";
  return `${item.discountPercent}% (−${formatQuoteMoney(amount)})`;
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
}): { amountAud: number; rateAudExGst: number; listRateAudExGst: number } {
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
    const listRateAudExGst =
      input.discountPercent > 0 && input.quantity > 0
        ? Math.round(
            (rateAudExGst / (1 - input.discountPercent / 100)) * 100,
          ) / 100
        : rateAudExGst;
    return { amountAud: gross, rateAudExGst, listRateAudExGst };
  }

  const amountAud =
    Math.round((gross / (1 + input.gstPercent / 100)) * 100) / 100;
  const rateAudExGst =
    input.quantity > 0
      ? Math.round((amountAud / input.quantity) * 100) / 100
      : input.rate;
  const listRateAudExGst =
    input.discountPercent > 0 && input.quantity > 0
      ? Math.round((rateAudExGst / (1 - input.discountPercent / 100)) * 100) /
        100
      : rateAudExGst;
  return { amountAud, rateAudExGst, listRateAudExGst };
}

/** Maps a stored quotation/invoice line to the shared document preview model. */
export function resolveDocumentLineFromQuotationItem(
  item: QuotationLineItem,
  defaultGst: number,
): QuotationDocumentLineItem {
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
  let discountPercent =
    typeof item.discountPercent === "number" &&
    Number.isFinite(item.discountPercent) &&
    item.discountPercent > 0
      ? Math.min(100, item.discountPercent)
      : 0;

  const unitRate =
    typeof item.rateAud === "number" && item.rateAud > 0
      ? item.rateAud
      : Math.round((item.priceAud / quantity) * 100) / 100;

  let listRateAud = unitRate;

  if (discountPercent <= 0 && unitRate > 0 && quantity > 0) {
    const gross = Math.round(unitRate * quantity * 100) / 100;
    if (gross > item.priceAud + 0.01) {
      const inferred = Math.min(
        100,
        Math.round((1 - item.priceAud / gross) * 10000) / 100,
      );
      if (inferred > 0.01) {
        discountPercent = inferred;
        listRateAud = unitRate;
      }
    }
  } else if (discountPercent > 0) {
    listRateAud =
      Math.round((unitRate / (1 - discountPercent / 100)) * 100) / 100;
  }

  return {
    code: item.code ?? null,
    name: item.name,
    description: item.description ?? null,
    quantity,
    rateAud: listRateAud,
    discountPercent,
    gstPercent: item.gstPercent ?? defaultGst,
    amountAud: item.priceAud,
  };
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
