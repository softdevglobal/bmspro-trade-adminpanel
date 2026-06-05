import type {
  InspectionAddress,
  InspectionCustomer,
} from "@/lib/inspection/types";
import type {
  QuotationDepositRequest,
  QuotationLineItem,
} from "@/lib/quotations/types";

export type InvoiceStatus = "draft" | "sent";

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
  createdAt: number | null;
  updatedAt: number | null;
};

export type CreateInvoiceInput = {
  quotationId: string;
  lineItems: QuotationLineItem[];
  finalPriceAud: number;
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
