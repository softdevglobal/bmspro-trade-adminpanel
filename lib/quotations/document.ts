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
  /**
   * Line net after quantity × rate and line discount.
   * Same regardless of exclusive/inclusive — mode only changes GST derivation.
   */
  amountAud: number;
  /** @deprecated Kept for older preview payloads; equals amountAud. */
  grossAud?: number;
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
  /** Optional metadata for document-level discount display (percent vs fixed). */
  documentDiscount?: DocumentDiscountDisplay | null;
  gstAud: number;
  /** Taxable base used for the GST row (after document discount share). */
  gstTaxableBaseAud?: number;
  /** How line nets relate to GST. Default exclusive when omitted (legacy docs). */
  gstPricing?: GstPricingMode;
  totalAud: number;
  deposit: QuotationDocumentDeposit | null;
  termsAndConditions: string | null;
  paymentInstructions: string | null;
  notes: string | null;
  business: QuotationDocumentBusiness;
};

export type DocumentDiscountDisplay = {
  mode: "percent" | "fixed";
  percent: number;
};

function formatPercentForLabel(percent: number): string {
  const rounded = Math.round(percent * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

/** Label for document-level discount rows, e.g. `Discount (15%)` or `Discount ($237.50)`. */
export function formatDocumentDiscountLabel(
  discountAud: number,
  subtotalAud: number,
  discount?: DocumentDiscountDisplay | null,
): string {
  if (discountAud <= 0.01) return "Discount";

  if (discount?.mode === "percent" && discount.percent > 0) {
    return `Discount (${formatPercentForLabel(discount.percent)}%)`;
  }

  if (discount?.mode === "fixed") {
    return `Discount (${formatQuoteMoney(discountAud)})`;
  }

  if (subtotalAud > 0) {
    const impliedPercent =
      Math.round((discountAud / subtotalAud) * 10000) / 100;
    const fromPercent =
      Math.round(((subtotalAud * impliedPercent) / 100) * 100) / 100;
    if (impliedPercent > 0 && Math.abs(fromPercent - discountAud) <= 0.02) {
      return `Discount (${formatPercentForLabel(impliedPercent)}%)`;
    }
  }

  return `Discount (${formatQuoteMoney(discountAud)})`;
}

/**
 * Recovers a document discount's mode/percent from a stored dollar amount.
 *
 * Quotations persist only the discount amount, not whether it was a percentage.
 * When converting to an invoice (or reloading a draft) we re-derive the percent
 * so a "10% off" discount keeps scaling as line items change, instead of being
 * frozen as a fixed dollar figure. Falls back to fixed when the amount doesn't
 * cleanly correspond to a percentage of the subtotal.
 */
export function inferDocumentDiscount(
  discountAud: number,
  subtotalAud: number,
): { mode: "percent" | "fixed"; percent: number; amountAud: number } | null {
  if (!(discountAud > 0)) return null;
  if (subtotalAud > 0) {
    const impliedPercent =
      Math.round((discountAud / subtotalAud) * 10000) / 100;
    const fromPercent =
      Math.round(((subtotalAud * impliedPercent) / 100) * 100) / 100;
    if (
      impliedPercent > 0 &&
      impliedPercent <= 100 &&
      Math.abs(fromPercent - discountAud) <= 0.02
    ) {
      return { mode: "percent", percent: impliedPercent, amountAud: discountAud };
    }
  }
  return { mode: "fixed", percent: 0, amountAud: discountAud };
}

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
  const fromPercent =
    Math.round(gross * (item.discountPercent / 100) * 100) / 100;
  const fromAmount = Math.max(
    0,
    Math.round((gross - item.amountAud) * 100) / 100,
  );
  if (Math.abs(fromPercent - fromAmount) <= 0.02) return fromPercent;
  return fromAmount;
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
  if (amount <= 0.01) return "—";

  const gross = Math.round(item.rateAud * item.quantity * 100) / 100;
  const percent =
    item.discountPercent > 0
      ? item.discountPercent
      : gross > 0
        ? Math.round((amount / gross) * 10000) / 100
        : 0;

  return `${formatPercentForLabel(percent)}% (-${formatQuoteMoney(amount)})`;
}

export function formatQuoteDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export type GstPricingMode = "exclusive" | "inclusive";

export function parseGstPricingMode(value: unknown): GstPricingMode {
  return value === "inclusive" ? "inclusive" : "exclusive";
}

/** GST toggle/percentage implied by stored quotation or invoice line items. */
export function deriveGstSettingsFromLineItems(
  lineItems: QuotationLineItem[],
): { enabled: boolean; percentage: number } {
  const taxable = lineItems.find((item) => (item.gstPercent ?? 0) > 0);
  if (!taxable) return { enabled: false, percentage: 10 };
  return {
    enabled: true,
    percentage: taxable.gstPercent ?? 10,
  };
}

/**
 * Infers pricing mode for legacy docs that never stored `gstPricing`.
 * When the saved total matches subtotal − discount (GST embedded), treat as inclusive.
 */
export function inferGstPricingMode(input: {
  subtotalAud: number;
  discountAud: number;
  finalPriceAud: number;
  hasTaxableLines: boolean;
}): GstPricingMode {
  if (!input.hasTaxableLines) return "exclusive";
  const afterDiscount = Math.max(
    0,
    Math.round((input.subtotalAud - Math.max(0, input.discountAud)) * 100) / 100,
  );
  if (Math.abs(input.finalPriceAud - afterDiscount) <= 0.02) {
    return "inclusive";
  }
  return "exclusive";
}

/** Label for GST totals rows, e.g. `GST (10%) · incl.` or `GST (10%) on $90.00`. */
export function formatGstTotalsLabel(input: {
  gstPercentage: number;
  gstPricing?: GstPricingMode | null;
  gstTaxableBaseAud?: number;
  afterDiscountAud?: number;
}): string {
  const pct = input.gstPercentage;
  const base =
    typeof input.gstTaxableBaseAud === "number"
      ? input.gstTaxableBaseAud
      : typeof input.afterDiscountAud === "number"
        ? input.afterDiscountAud
        : null;
  const onBase =
    base != null &&
    typeof input.afterDiscountAud === "number" &&
    Math.abs(base - input.afterDiscountAud) > 0.009
      ? ` on ${formatQuoteMoney(base)}`
      : "";

  if (input.gstPricing === "inclusive") {
    return `GST (${pct}%)${onBase} · incl.`;
  }
  return `GST (${pct}%)${onBase}`;
}

/**
 * Converts entered rate/qty/discount to the line net for documents.
 * Line nets are identical for exclusive and inclusive — mode only affects GST.
 */
export function computeQuotationLineAmounts(input: {
  quantity: number;
  rate: number;
  discountPercent: number;
  gstPercent: number;
  gstPricing: GstPricingMode;
}): {
  amountAud: number;
  rateAudExGst: number;
  listRateAudExGst: number;
  grossAud: number;
} {
  void input.gstPercent;
  void input.gstPricing;
  const amountAud =
    Math.round(
      input.quantity *
        input.rate *
        (1 - input.discountPercent / 100) *
        100,
    ) / 100;
  const rateAudExGst =
    input.quantity > 0
      ? Math.round((amountAud / input.quantity) * 100) / 100
      : input.rate;
  const listRateAudExGst =
    input.discountPercent > 0 && input.quantity > 0
      ? Math.round(
          (rateAudExGst / (1 - input.discountPercent / 100)) * 100,
        ) / 100
      : rateAudExGst;
  return {
    amountAud,
    rateAudExGst,
    listRateAudExGst,
    grossAud: amountAud,
  };
}

/** True when the line item has a persisted pre-discount list rate. */
export function hasStoredListRate(item: QuotationLineItem): boolean {
  return typeof item.rateAud === "number" && item.rateAud > 0;
}

function resolveDiscountPercentFromQuotationItem(
  item: QuotationLineItem,
  quantity: number,
  unitRate: number,
): number {
  // A stored discount percent is what the customer actually entered — trust it.
  const stored =
    typeof item.discountPercent === "number" &&
    Number.isFinite(item.discountPercent) &&
    item.discountPercent > 0
      ? Math.min(100, item.discountPercent)
      : 0;
  if (stored > 0) return stored;

  // Legacy records without a stored percent: infer it from the list rate vs the
  // net line total when the two disagree.
  if (unitRate > 0 && quantity > 0) {
    const gross = Math.round(unitRate * quantity * 100) / 100;
    if (gross > item.priceAud + 0.01) {
      const inferred = Math.min(
        100,
        Math.round((1 - item.priceAud / gross) * 10000) / 100,
      );
      if (inferred > 0.01) return inferred;
    }
  }

  return 0;
}

/**
 * Resolves the pre-discount list rate (ex-GST) for display.
 *
 * The net line total (`priceAud`) is the source of truth because it drives the
 * document total, so we derive the list rate from it and the resolved discount
 * rather than trusting a stored `rateAud`, which can be stale or corrupted
 * (e.g. double-inflated) and would show a wrong rate/discount in the document.
 */
export function resolveListRateFromQuotationItem(
  item: QuotationLineItem,
  quantity: number,
  discountPercent: number,
): number {
  const qty = quantity > 0 ? quantity : 1;
  const unitNet = Math.round((item.priceAud / qty) * 100) / 100;

  if (discountPercent <= 0 || discountPercent >= 100) {
    return hasStoredListRate(item) ? item.rateAud! : unitNet;
  }

  return Math.round((unitNet / (1 - discountPercent / 100)) * 100) / 100;
}

/** Restores quantity, discount, and list rate from a persisted line item. */
export function resolveQuotationItemPricing(item: QuotationLineItem): {
  quantity: number;
  discountPercent: number;
  listRateAud: number;
} {
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const storedListRate = hasStoredListRate(item);
  const unitRate = storedListRate
    ? item.rateAud!
    : Math.round((item.priceAud / quantity) * 100) / 100;
  const discountPercent = resolveDiscountPercentFromQuotationItem(
    item,
    quantity,
    unitRate,
  );
  const listRateAud = resolveListRateFromQuotationItem(
    item,
    quantity,
    discountPercent,
  );
  return { quantity, discountPercent, listRateAud };
}

/** Maps a stored quotation/invoice line to the shared document preview model. */
export function resolveDocumentLineFromQuotationItem(
  item: QuotationLineItem,
  defaultGst: number,
): QuotationDocumentLineItem {
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const storedListRate = hasStoredListRate(item);
  const unitRate = storedListRate
    ? item.rateAud!
    : Math.round((item.priceAud / quantity) * 100) / 100;
  const discountPercent = resolveDiscountPercentFromQuotationItem(
    item,
    quantity,
    unitRate,
  );
  const listRateAud = resolveListRateFromQuotationItem(
    item,
    quantity,
    discountPercent,
  );

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
  /**
   * Exclusive: GST is added on top of line nets.
   * Inclusive: GST is extracted from line nets; total stays subtotal − discount.
   */
  gstPricing?: GstPricingMode;
}): {
  subtotalAud: number;
  gstAud: number;
  totalAud: number;
  gstTaxableBaseAud: number;
} {
  const subtotalAud =
    Math.round(
      input.lineItems.reduce((sum, item) => sum + item.amountAud, 0) * 100,
    ) / 100;
  const discountAud = Math.min(
    Math.max(0, input.discountAud),
    subtotalAud,
  );
  const afterDiscount = Math.max(0, Math.round((subtotalAud - discountAud) * 100) / 100);
  const discountRatio = subtotalAud > 0 ? discountAud / subtotalAud : 0;

  const gstItemsNet =
    Math.round(
      input.lineItems.reduce((sum, item) => {
        if (item.gstPercent <= 0) return sum;
        return sum + item.amountAud;
      }, 0) * 100,
    ) / 100;
  const gstTaxableBaseAud =
    Math.round(gstItemsNet * (1 - discountRatio) * 100) / 100;

  if (gstTaxableBaseAud <= 0) {
    return {
      subtotalAud,
      gstAud: 0,
      totalAud: afterDiscount,
      gstTaxableBaseAud: 0,
    };
  }

  if (input.gstPricing === "inclusive") {
    // Extract GST already embedded in the taxable base.
    const gstAud =
      Math.round(
        input.lineItems.reduce((sum, item) => {
          if (item.gstPercent <= 0) return sum;
          const lineBase = item.amountAud * (1 - discountRatio);
          const embedded =
            lineBase - lineBase / (1 + item.gstPercent / 100);
          return sum + embedded;
        }, 0) * 100,
      ) / 100;
    return {
      subtotalAud,
      gstAud,
      totalAud: afterDiscount,
      gstTaxableBaseAud,
    };
  }

  // Exclusive: add GST on top of the taxable base.
  const gstAud =
    Math.round(
      input.lineItems.reduce((sum, item) => {
        if (item.gstPercent <= 0) return sum;
        const lineBase = item.amountAud * (1 - discountRatio);
        return sum + lineBase * (item.gstPercent / 100);
      }, 0) * 100,
    ) / 100;

  return {
    subtotalAud,
    gstAud,
    totalAud: Math.round((afterDiscount + gstAud) * 100) / 100,
    gstTaxableBaseAud,
  };
}

export function buildCustomerAddressLine(address: InspectionAddress): string {
  return formatAddress(address);
}
