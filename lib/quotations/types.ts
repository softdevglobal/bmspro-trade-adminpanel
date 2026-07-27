import type { BookingStatus } from "@/lib/bookings/types";
import type { InvoiceStatus } from "@/lib/invoices/types";
import type { DepositPaymentRecord } from "@/lib/payments/types";
import type {
  InspectionAddress,
  InspectionCustomer,
  InspectionRequestCreatedSource,
  InspectionRequestStatus,
} from "@/lib/inspection/types";

export type QuotationLineItem = {
  name: string;
  priceAud: number;
  code?: string | null;
  description?: string | null;
  quantity?: number | null;
  rateAud?: number | null;
  /** Line-level discount (0–100). Omitted on older records. */
  discountPercent?: number | null;
  gstPercent?: number | null;
};

export type QuotationDepositRequest = {
  mode: "percent" | "fixed";
  percent: number;
  amountAud: number;
  dueDate: string;
  /** Invoices only: true when the deposit has already been received. */
  paid?: boolean;
};

export type QuotationStatus = "draft" | "sent" | "cancelled";

export type QuotationDetail = {
  id: string;
  quotationCode: string | null;
  businessId: string;
  inspectionRequestId: string;
  serviceTitle: string;
  serviceDescription: string | null;
  customer: InspectionCustomer;
  address: InspectionAddress;
  lineItems: QuotationLineItem[];
  subtotalAud: number;
  finalPriceAud: number;
  /** Amount still owed after any deposit (equals finalPriceAud when no deposit). */
  balanceDueAud: number;
  notes: string | null;
  paymentInstructions: string | null;
  termsAndConditions: string | null;
  discountAud: number;
  /** Exclusive adds GST on top; inclusive extracts GST from line nets. */
  gstPricing: "exclusive" | "inclusive";
  depositRequest: QuotationDepositRequest | null;
  /** Set once a Stripe deposit payment has settled for this quotation. */
  depositPayment: DepositPaymentRecord | null;
  validUntil: string | null;
  imageUrls: string[];
  pdfUrl: string | null;
  status: QuotationStatus;
  cancelledFromStatus: Exclude<QuotationStatus, "cancelled"> | null;
  /** Customer accept/reject response (null until the customer decides). */
  customerDecision: "accepted" | "rejected" | null;
  customerDecisionAt: number | null;
  bookingId: string | null;
  bookingCode: string | null;
  bookingStatus: BookingStatus | null;
  bookingStatusAt: number | null;
  /** Set when an invoice document exists for this quotation (same id). */
  invoiceId: string | null;
  invoiceCode: string | null;
  invoiceStatus: InvoiceStatus | null;
  invoicePdfUrl: string | null;
  createdBy: string;
  createdAt: number | null;
  updatedAt: number | null;
  /** From the linked request (`createdSource`). */
  createdSource?: InspectionRequestCreatedSource | null;
  /** Linked request status (for follow-up actions). */
  inspectionRequestStatus?: InspectionRequestStatus | null;
};

export type CreateQuotationInput = {
  inspectionRequestId: string;
  serviceDescription?: string | null;
  /** Allows editing flows to (re)tag the backing request as a service or custom quote. */
  requestType?: "existing_service" | "custom_quote";
  serviceId?: string | null;
  customRequest?: { title: string; description: string } | null;
  serviceTitle?: string | null;
  lineItems: QuotationLineItem[];
  finalPriceAud?: number | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  discountAud?: number | null;
  gstPricing?: "exclusive" | "inclusive" | null;
  validUntil?: string | null;
  imageUrls?: string[];
  depositRequest?: unknown;
  customer?: { fullName?: string; email?: string; phone?: string };
  address?: {
    street?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
  /** When true, emails/SMS the customer and marks the quotation as sent. */
  send?: boolean;
};
