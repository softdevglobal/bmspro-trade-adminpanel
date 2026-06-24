import type { BookingDetail } from "@/lib/bookings/types";
import type { InvoiceDetail } from "@/lib/invoices/types";
import {
  STATUS_LABELS,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
} from "@/lib/inspection/types";

export type CustomerWorkDisplayStatus =
  | InspectionRequestStatus
  | "pending_payment"
  | "job_completed";

export const CUSTOMER_WORK_STATUS_LABELS: Record<
  CustomerWorkDisplayStatus,
  string
> = {
  ...STATUS_LABELS,
  pending_payment: "Pending payment",
  job_completed: "Job completed",
};

export type CustomerWorkContext = {
  request: InspectionRequestDetail;
  booking?: BookingDetail | null;
  invoice?: InvoiceDetail | null;
};

function resolveInvoiceStatus(
  ctx: CustomerWorkContext,
): "draft" | "sent" | "paid" | null {
  return ctx.invoice?.status ?? ctx.request.invoice?.status ?? null;
}

function resolveJobStatus(
  ctx: CustomerWorkContext,
): BookingDetail["status"] | null {
  return ctx.booking?.status ?? ctx.request.bookingStatus ?? null;
}

/** Work is fully complete only after the invoice is marked paid. */
export function resolveCustomerWorkStatus(
  ctx: CustomerWorkContext,
): CustomerWorkDisplayStatus {
  const { request } = ctx;
  const invoiceStatus = resolveInvoiceStatus(ctx);
  const jobStatus = resolveJobStatus(ctx);

  if (request.status === "cancelled") return "cancelled";
  if (invoiceStatus === "paid") return "completed";
  if (invoiceStatus === "sent") return "pending_payment";
  if (jobStatus === "completed") return "job_completed";

  // `request.status` may be "completed" after the inspection visit or when an
  // invoice is sent — that is not the same as the customer work being closed.
  if (request.status === "completed") {
    if (request.bookingId || ctx.booking) return "job_completed";
    return "awaiting_decision";
  }

  return request.status;
}

export function isCustomerWorkFullyComplete(ctx: CustomerWorkContext): boolean {
  return resolveInvoiceStatus(ctx) === "paid";
}

export function customerWorkInvoiceSummary(ctx: CustomerWorkContext) {
  if (ctx.invoice) {
    return {
      invoiceCode: ctx.invoice.invoiceCode,
      finalPriceAud: ctx.invoice.finalPriceAud,
      status: ctx.invoice.status,
    };
  }
  if (ctx.request.invoice) {
    return {
      invoiceCode: ctx.request.invoice.invoiceCode,
      finalPriceAud: ctx.request.invoice.finalPriceAud,
      status: ctx.request.invoice.status,
    };
  }
  return null;
}
