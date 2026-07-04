import type { BookingStatus } from "@/lib/bookings/types";
import type {
  InspectionAddress,
  InspectionCustomer,
} from "@/lib/inspection/types";
import type {
  QuotationDepositRequest,
  QuotationLineItem,
} from "@/lib/quotations/types";

export type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";

export type InvoiceDetail = {
  id: string;
  invoiceCode: string;
  businessId: string;
  quotationId: string;
  quotationCode: string | null;
  inspectionRequestId: string;
  serviceTitle: string;
  customer: InspectionCustomer;
  address: InspectionAddress;
  lineItems: QuotationLineItem[];
  subtotalAud: number;
  discountAud: number;
  gstAud: number;
  finalPriceAud: number;
  /** Amount still owed after any deposit (equals finalPriceAud when no deposit). */
  balanceDueAud: number;
  depositRequest: QuotationDepositRequest | null;
  notes: string | null;
  termsAndConditions: string | null;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  bookingId: string | null;
  bookingCode: string | null;
  bookingStatus: BookingStatus | null;
  bookingStatusAt: number | null;
  pdfUrl: string | null;
  /** When the invoice was cancelled (null unless status is `cancelled`). */
  cancelledAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CreateInvoiceInput = {
  quotationId: string;
  lineItems: QuotationLineItem[];
  finalPriceAud: number;
  customer?: { fullName: string; email: string; phone: string };
  address?: {
    street?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
  serviceTitle?: string;
  discountAud?: number | null;
  gstAud?: number | null;
  depositRequest?: unknown;
  notes?: string | null;
  termsAndConditions?: string | null;
  invoiceDate: string;
  dueDate: string;
  /** When true, marks the invoice as sent and emails the customer. */
  send?: boolean;
};

/**
 * Direct invoice (no existing quotation). The server creates the full
 * record chain — completed request, accepted quotation, completed job —
 * so the invoice reads like any other finished job.
 */
export type CreateDirectInvoiceInput = Omit<CreateInvoiceInput, "quotationId"> & {
  customer: { fullName: string; email: string; phone: string };
  address: {
    street?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
  serviceTitle?: string;
  description?: string | null;
  requestType?: "existing_service" | "custom_quote";
  serviceId?: string | null;
  customRequest?: { title: string; description: string } | null;
};
