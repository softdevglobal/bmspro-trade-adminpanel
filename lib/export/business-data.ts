import type { BookingDetail } from "@/lib/bookings/types";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/types";
import type { InvoiceDetail } from "@/lib/invoices/types";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import {
  CREATED_SOURCE_LABELS,
  STATUS_LABELS,
  TIME_RANGE_LABELS,
  formatAddress,
  formatSlotDate,
  formatVisitWindow,
} from "@/lib/inspection/types";
import type { QuotationDetail } from "@/lib/quotations/types";
import {
  displayBookingCode,
  displayInspectionRequestCode,
  displayQuotationCode,
} from "@/lib/reference-codes";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import {
  type ExportRow,
  formatExportDate,
  formatExportMoney,
  formatExportTimestamp,
  joinExportValues,
} from "@/lib/export/tabular";

export type ExportDatasetKey =
  | "requests"
  | "quotations"
  | "jobs"
  | "invoices"
  | "customers";

export const EXPORT_DATASET_LABELS: Record<ExportDatasetKey, string> = {
  requests: "Requests",
  quotations: "Quotations",
  jobs: "Jobs",
  invoices: "Invoices",
  customers: "Customers",
};

function requestTitle(request: InspectionRequestDetail): string {
  if (request.requestType === "existing_service") {
    return request.serviceName ?? "Service request";
  }
  return request.customRequest?.title ?? "Custom quotation";
}

function bookingTitle(booking: BookingDetail): string {
  if (booking.requestType === "existing_service") {
    return booking.serviceName ?? "Existing service";
  }
  return booking.customRequest?.title ?? "Custom quotation request";
}

function customerKey(request: InspectionRequestDetail): string {
  const email = request.customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = request.customer.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${request.customer.fullName.trim().toLowerCase()}`;
}

type CustomerSummary = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  requestCount: number;
  lastActivity: number;
  requests: InspectionRequestDetail[];
};

function buildCustomerSummaries(
  requests: InspectionRequestDetail[],
): CustomerSummary[] {
  const map = new Map<string, CustomerSummary>();
  for (const request of requests) {
    const key = customerKey(request);
    const activity = request.updatedAt ?? request.createdAt ?? 0;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        id: key,
        fullName: request.customer.fullName?.trim() || "Unknown customer",
        email: request.customer.email?.trim() || "",
        phone: request.customer.phone?.trim() || "",
        requestCount: 1,
        lastActivity: activity,
        requests: [request],
      });
      continue;
    }
    existing.requestCount += 1;
    existing.requests.push(request);
    if (activity > existing.lastActivity) {
      existing.lastActivity = activity;
    }
    if (!existing.fullName && request.customer.fullName) {
      existing.fullName = request.customer.fullName.trim();
    }
    if (!existing.email && request.customer.email) {
      existing.email = request.customer.email.trim();
    }
    if (!existing.phone && request.customer.phone) {
      existing.phone = request.customer.phone.trim();
    }
  }
  return Array.from(map.values()).sort((a, b) => b.lastActivity - a.lastActivity);
}

export function buildRequestsExportRows(
  requests: InspectionRequestDetail[],
  bookings: BookingDetail[],
  timeZone?: string | null,
): ExportRow[] {
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  return requests.map((request) => {
    const linkedJob = request.bookingId ? bookingById.get(request.bookingId) ?? null : null;
    return {
      "Request Code": displayInspectionRequestCode(request),
      Status: STATUS_LABELS[request.status],
      Source: request.createdSource ? CREATED_SOURCE_LABELS[request.createdSource] : "",
      Customer: request.customer.fullName,
      Email: request.customer.email,
      Phone: formatAuPhoneDisplay(request.customer.phone),
      Service: requestTitle(request),
      "Business Type": request.serviceBusinessType ?? "",
      Address: formatAddress(request.address),
      "Customer Notes": request.customerNotes ?? "",
      Budget: formatExportMoney(request.budgetAud),
      "Inspection Date": request.scheduledSlot
        ? formatSlotDate(request.scheduledSlot.date, timeZone)
        : "",
      "Inspection Window": formatVisitWindow(
        request.scheduledStartTime,
        request.scheduledEndTime,
      ),
      "Preferred Slots": request.preferredSlots
        .map((slot) =>
          joinExportValues(
            [formatSlotDate(slot.date, timeZone), TIME_RANGE_LABELS[slot.timeRange]],
            " ",
          ),
        )
        .join(" | "),
      "Quotation Code": request.quotation?.quotationCode ?? "",
      "Quotation Status": request.quotation?.status ?? "",
      "Quotation Total": formatExportMoney(request.quotation?.finalPriceAud),
      "Customer Decision": request.quotation?.customerDecision ?? "",
      "Job Code": request.bookingCode ?? "",
      "Job Status": request.bookingStatus
        ? BOOKING_STATUS_LABELS[request.bookingStatus]
        : "",
      "Assigned To": linkedJob?.assignedTo?.name ?? request.assignedTo?.name ?? "",
      "Invoice Code": request.invoice?.invoiceCode ?? "",
      "Invoice Status": request.invoice?.status ?? "",
      "Invoice Balance": formatExportMoney(request.invoice?.balanceDueAud),
      Created: formatExportTimestamp(request.createdAt, timeZone),
      Updated: formatExportTimestamp(request.updatedAt, timeZone),
    };
  });
}

export function buildQuotationsExportRows(
  quotations: QuotationDetail[],
  timeZone?: string | null,
): ExportRow[] {
  return quotations.map((quotation) => ({
    "Quotation Code": displayQuotationCode(quotation),
    Status: quotation.status,
    Customer: quotation.customer.fullName,
    Email: quotation.customer.email,
    Phone: formatAuPhoneDisplay(quotation.customer.phone),
    Service: quotation.serviceTitle || "Quotation",
    Description: quotation.serviceDescription ?? "",
    Address: formatAddress(quotation.address),
    Subtotal: formatExportMoney(quotation.subtotalAud),
    "Final Price": formatExportMoney(quotation.finalPriceAud),
    Balance: formatExportMoney(quotation.balanceDueAud),
    Deposit: formatExportMoney(quotation.depositRequest?.amountAud),
    "Valid Until": formatExportDate(quotation.validUntil, timeZone),
    "Customer Decision": quotation.customerDecision ?? "",
    "Job Code": quotation.bookingCode ?? "",
    "Job Status": quotation.bookingStatus
      ? BOOKING_STATUS_LABELS[quotation.bookingStatus]
      : "",
    "Invoice Code": quotation.invoiceCode ?? "",
    "Invoice Status": quotation.invoiceStatus ?? "",
    Source: quotation.createdSource ? CREATED_SOURCE_LABELS[quotation.createdSource] : "",
    Created: formatExportTimestamp(quotation.createdAt, timeZone),
    Updated: formatExportTimestamp(quotation.updatedAt, timeZone),
  }));
}

export function buildJobsExportRows(
  bookings: BookingDetail[],
  timeZone?: string | null,
): ExportRow[] {
  return bookings.map((booking) => ({
    "Job Code": displayBookingCode(booking),
    Status: BOOKING_STATUS_LABELS[booking.status],
    Customer: booking.customer.fullName,
    Email: booking.customer.email,
    Phone: formatAuPhoneDisplay(booking.customer.phone),
    Service: bookingTitle(booking),
    "Business Type": booking.serviceBusinessType ?? "",
    Address: formatAddress(booking.address),
    "Inspection Request Code": booking.inspectionRequestCode ?? "",
    "Scheduled Date": booking.scheduledSlot
      ? formatSlotDate(booking.scheduledSlot.date, timeZone)
      : "",
    "Time Range": booking.scheduledSlot
      ? TIME_RANGE_LABELS[booking.scheduledSlot.timeRange]
      : "",
    "Visit Window": formatVisitWindow(
      booking.scheduledStartTime,
      booking.scheduledEndTime,
    ),
    "Additional Job Days": booking.additionalJobDays
      .map((slot) =>
        joinExportValues(
          [formatSlotDate(slot.date, timeZone), TIME_RANGE_LABELS[slot.timeRange]],
          " ",
        ),
      )
      .join(" | "),
    "Assigned To": booking.assignedTo?.name ?? "",
    "Quotation Code": booking.quotation ? displayQuotationCode(booking.quotation) : "",
    "Quotation Total": formatExportMoney(booking.quotation?.finalPriceAud),
    "Customer Note": booking.ownerNote ?? "",
    "Job Instructions": booking.jobInstructionsDescription ?? "",
    "Instruction Tasks": booking.jobInstructionsTasks.join(" | "),
    Created: formatExportTimestamp(booking.createdAt, timeZone),
    Updated: formatExportTimestamp(booking.updatedAt, timeZone),
  }));
}

export function buildInvoicesExportRows(
  invoices: InvoiceDetail[],
  timeZone?: string | null,
): ExportRow[] {
  return invoices.map((invoice) => ({
    "Invoice Code": invoice.invoiceCode,
    Status: invoice.status === "sent" ? "due" : invoice.status,
    Customer: invoice.customer.fullName,
    Email: invoice.customer.email,
    Phone: formatAuPhoneDisplay(invoice.customer.phone),
    Service: invoice.serviceTitle || "Invoice",
    Address: formatAddress(invoice.address),
    Subtotal: formatExportMoney(invoice.subtotalAud),
    Discount: formatExportMoney(invoice.discountAud),
    GST: formatExportMoney(invoice.gstAud),
    Total: formatExportMoney(invoice.finalPriceAud),
    "Amount Paid": formatExportMoney(invoice.amountPaidAud),
    Balance: formatExportMoney(invoice.balanceDueAud),
    "Deposit Requested": formatExportMoney(invoice.depositRequest?.amountAud),
    "Invoice Date": formatExportDate(invoice.invoiceDate, timeZone),
    "Due Date": formatExportDate(invoice.dueDate, timeZone),
    "Quotation Code": invoice.quotationCode ?? "",
    "Job Code": invoice.bookingCode ?? "",
    "Job Status": invoice.bookingStatus ? BOOKING_STATUS_LABELS[invoice.bookingStatus] : "",
    Notes: invoice.notes ?? "",
    Created: formatExportTimestamp(invoice.createdAt, timeZone),
    Updated: formatExportTimestamp(invoice.updatedAt, timeZone),
  }));
}

export function buildCustomersExportRows(
  requests: InspectionRequestDetail[],
  bookings: BookingDetail[],
  invoices: InvoiceDetail[],
  timeZone?: string | null,
): ExportRow[] {
  const customers = buildCustomerSummaries(requests);
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const invoiceByRequestId = new Map(
    invoices.map((invoice) => [invoice.inspectionRequestId, invoice] as const),
  );
  return customers.map((customer) => {
    const latestRequest =
      [...customer.requests].sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
      )[0] ?? null;
    const latestBooking =
      latestRequest?.bookingId ? bookingById.get(latestRequest.bookingId) ?? null : null;
    const latestInvoice = latestRequest
      ? invoiceByRequestId.get(latestRequest.id) ?? null
      : null;
    return {
      Customer: customer.fullName,
      Email: customer.email,
      Phone: formatAuPhoneDisplay(customer.phone),
      "Request Count": customer.requestCount,
      "Last Activity": formatExportTimestamp(customer.lastActivity, timeZone),
      "Latest Request Code": latestRequest ? latestRequest.requestCode ?? latestRequest.id : "",
      "Latest Request Status": latestRequest?.status ?? "",
      "Latest Service": latestRequest ? requestTitle(latestRequest) : "",
      "Latest Address": latestRequest ? formatAddress(latestRequest.address) : "",
      "Latest Quotation": latestRequest?.quotation
        ? displayQuotationCode(latestRequest.quotation)
        : "",
      "Latest Job": latestBooking ? displayBookingCode(latestBooking) : "",
      "Latest Invoice": latestInvoice?.invoiceCode ?? "",
      "All Request Codes": customer.requests
        .map((request) => request.requestCode ?? request.id)
        .join(" | "),
    };
  });
}
