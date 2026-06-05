import type { BookingStatus } from "@/lib/bookings/types";
import type { InvoiceStatus } from "@/lib/invoices/types";
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
  gstPercent?: number | null;
};

export type QuotationDepositRequest = {
  mode: "percent" | "fixed";
  percent: number;
  amountAud: number;
  dueDate: string;
};

export type QuotationDetail = {
  id: string;
  quotationCode: string | null;
  businessId: string;
  inspectionRequestId: string;
  serviceTitle: string;
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
  depositRequest: QuotationDepositRequest | null;
  validUntil: string | null;
  imageUrls: string[];
  pdfUrl: string | null;
  status: "draft" | "sent";
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
  /** From the linked inspection visit (`createdSource`). */
  createdSource?: InspectionRequestCreatedSource | null;
  /** Linked inspection visit status (for follow-up actions). */
  inspectionRequestStatus?: InspectionRequestStatus | null;
};

export type CreateQuotationInput = {
  inspectionRequestId: string;
  lineItems: QuotationLineItem[];
  finalPriceAud?: number | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  discountAud?: number | null;
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
};
