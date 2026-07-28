import { bookingScheduleDays } from "@/lib/bookings/map-booking-doc";
import type { BookingDetail } from "@/lib/bookings/types";
import {
  formatAddress,
  formatSlotDate,
  formatVisitWindow,
  TIME_RANGE_LABELS,
  type InspectionAddress,
  type InspectionCustomer,
} from "@/lib/inspection/types";
import type { InvoiceDetail } from "@/lib/invoices/types";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import { formatQuoteDate } from "@/lib/quotations/document";
import type {
  QuotationDepositRequest,
  QuotationDetail,
  QuotationLineItem,
} from "@/lib/quotations/types";

export type DocumentCopySectionId =
  | "client"
  | "jobDetails"
  | "lineItems"
  | "deposit"
  | "termsNotes"
  | "attachments";

export type JobCopySectionId =
  | "client"
  | "service"
  | "schedule"
  | "notesInstructions"
  | "assignment";

export type CopySectionOption<T extends string = string> = {
  id: T;
  label: string;
  disabled: boolean;
  defaultChecked: boolean;
};

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

function hasClientData(
  customer: InspectionCustomer,
  address: InspectionAddress,
): boolean {
  return Boolean(
    customer.fullName?.trim() ||
      customer.email?.trim() ||
      customer.phone?.trim() ||
      address.street?.trim() ||
      address.suburb?.trim() ||
      address.state?.trim() ||
      address.postcode?.trim(),
  );
}

function formatClientBlock(
  customer: InspectionCustomer,
  address: InspectionAddress,
): string {
  const lines: string[] = ["Client"];
  if (customer.fullName?.trim()) lines.push(customer.fullName.trim());
  const phone = formatAuPhoneDisplay(customer.phone);
  const contact = [phone, customer.email?.trim()].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  const formattedAddress = formatAddress(address);
  if (formattedAddress) lines.push(formattedAddress);
  return lines.join("\n");
}

function formatLineItemRow(item: QuotationLineItem): string {
  const qty =
    item.quantity != null && item.quantity > 0 && item.quantity !== 1
      ? ` × ${item.quantity}`
      : "";
  const desc = item.description?.trim()
    ? `\n  ${item.description.trim()}`
    : "";
  return `${item.name}${qty} — ${formatAud(item.priceAud)}${desc}`;
}

function formatDepositBlock(deposit: QuotationDepositRequest): string {
  const lines: string[] = ["Deposit"];
  if (deposit.mode === "percent" && deposit.percent) {
    lines.push(`Deposit (${deposit.percent}%): ${formatAud(deposit.amountAud)}`);
  } else {
    lines.push(`Deposit required: ${formatAud(deposit.amountAud)}`);
  }
  if (deposit.dueDate) {
    lines.push(`Due: ${formatQuoteDate(deposit.dueDate)}`);
  }
  if (deposit.paid) {
    lines.push("Status: Paid");
  }
  return lines.join("\n");
}

function joinSections(parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join("\n\n");
}

function option<T extends string>(
  id: T,
  label: string,
  hasData: boolean,
): CopySectionOption<T> {
  return {
    id,
    label,
    disabled: !hasData,
    defaultChecked: hasData,
  };
}

export function quotationCopySections(
  quotation: QuotationDetail,
): CopySectionOption<DocumentCopySectionId>[] {
  const hasJobDetails = Boolean(
    quotation.serviceTitle?.trim() || quotation.serviceDescription?.trim(),
  );
  const hasTermsNotes = Boolean(
    quotation.termsAndConditions?.trim() || quotation.notes?.trim(),
  );
  return [
    option("client", "Client", hasClientData(quotation.customer, quotation.address)),
    option("jobDetails", "Job details", hasJobDetails),
    option("lineItems", "Line items", quotation.lineItems.length > 0),
    option("deposit", "Deposit", quotation.depositRequest != null),
    option("termsNotes", "Terms & notes", hasTermsNotes),
    option("attachments", "Attachments", quotation.imageUrls.length > 0),
  ];
}

export function invoiceCopySections(
  invoice: InvoiceDetail,
): CopySectionOption<DocumentCopySectionId>[] {
  const hasJobDetails = Boolean(invoice.serviceTitle?.trim());
  const hasTermsNotes = Boolean(
    invoice.termsAndConditions?.trim() || invoice.notes?.trim(),
  );
  return [
    option("client", "Client", hasClientData(invoice.customer, invoice.address)),
    option("jobDetails", "Job details", hasJobDetails),
    option("lineItems", "Line items", invoice.lineItems.length > 0),
    option("deposit", "Deposit", invoice.depositRequest != null),
    option("termsNotes", "Terms & notes", hasTermsNotes),
    option("attachments", "Attachments", false),
  ];
}

export function jobCopySections(
  booking: BookingDetail,
): CopySectionOption<JobCopySectionId>[] {
  const hasService =
    booking.requestType === "existing_service"
      ? Boolean(booking.serviceName?.trim())
      : Boolean(
          booking.customRequest?.title?.trim() ||
            booking.customRequest?.description?.trim(),
        );
  const hasSchedule = bookingScheduleDays(booking).length > 0;
  const hasNotes = Boolean(
    booking.ownerNote?.trim() ||
      booking.jobInstructionsDescription?.trim() ||
      booking.jobInstructionsTasks.length > 0,
  );
  return [
    option("client", "Client", hasClientData(booking.customer, booking.address)),
    option("service", "Service", hasService),
    option("schedule", "Schedule", hasSchedule),
    option("notesInstructions", "Notes & instructions", hasNotes),
    option("assignment", "Assignment", booking.assignedTo != null),
  ];
}

export function formatQuotationCopyText(
  quotation: QuotationDetail,
  selected: readonly DocumentCopySectionId[],
): string {
  const selectedSet = new Set(selected);
  const parts: string[] = [];

  if (selectedSet.has("client")) {
    parts.push(formatClientBlock(quotation.customer, quotation.address));
  }

  if (selectedSet.has("jobDetails")) {
    const lines = ["Job details"];
    if (quotation.serviceTitle?.trim()) {
      lines.push(quotation.serviceTitle.trim());
    }
    if (quotation.serviceDescription?.trim()) {
      lines.push(quotation.serviceDescription.trim());
    }
    parts.push(lines.join("\n"));
  }

  if (selectedSet.has("lineItems")) {
    const lines = ["Line items"];
    for (const item of quotation.lineItems) {
      lines.push(formatLineItemRow(item));
    }
    if (quotation.discountAud > 0) {
      lines.push(`Discount: −${formatAud(quotation.discountAud)}`);
    }
    lines.push(`Subtotal: ${formatAud(quotation.subtotalAud)}`);
    lines.push(`Final price: ${formatAud(quotation.finalPriceAud)}`);
    parts.push(lines.join("\n"));
  }

  if (selectedSet.has("deposit") && quotation.depositRequest) {
    parts.push(formatDepositBlock(quotation.depositRequest));
  }

  if (selectedSet.has("termsNotes")) {
    const lines: string[] = [];
    if (quotation.termsAndConditions?.trim()) {
      lines.push("Terms and conditions", quotation.termsAndConditions.trim());
    }
    if (quotation.notes?.trim()) {
      if (lines.length) lines.push("");
      lines.push("Notes", quotation.notes.trim());
    }
    if (lines.length) parts.push(lines.join("\n"));
  }

  if (selectedSet.has("attachments") && quotation.imageUrls.length > 0) {
    parts.push(["Attachments", ...quotation.imageUrls].join("\n"));
  }

  return joinSections(parts);
}

export function formatInvoiceCopyText(
  invoice: InvoiceDetail,
  selected: readonly DocumentCopySectionId[],
): string {
  const selectedSet = new Set(selected);
  const parts: string[] = [];

  if (selectedSet.has("client")) {
    parts.push(formatClientBlock(invoice.customer, invoice.address));
  }

  if (selectedSet.has("jobDetails")) {
    const lines = ["Job details"];
    if (invoice.serviceTitle?.trim()) {
      lines.push(invoice.serviceTitle.trim());
    }
    parts.push(lines.join("\n"));
  }

  if (selectedSet.has("lineItems")) {
    const lines = ["Line items"];
    if (invoice.invoiceDate || invoice.dueDate) {
      lines.push(
        `Invoice date: ${formatQuoteDate(invoice.invoiceDate)} · Due: ${formatQuoteDate(invoice.dueDate)}`,
      );
    }
    for (const item of invoice.lineItems) {
      lines.push(formatLineItemRow(item));
    }
    lines.push(`Subtotal: ${formatAud(invoice.subtotalAud)}`);
    if (invoice.discountAud > 0) {
      lines.push(`Discount: −${formatAud(invoice.discountAud)}`);
    }
    if (invoice.gstAud > 0) {
      lines.push(`GST: ${formatAud(invoice.gstAud)}`);
    }
    lines.push(`Total: ${formatAud(invoice.finalPriceAud)}`);
    if (invoice.depositRequest) {
      lines.push(`Balance due: ${formatAud(invoice.balanceDueAud)}`);
    }
    parts.push(lines.join("\n"));
  }

  if (selectedSet.has("deposit") && invoice.depositRequest) {
    parts.push(formatDepositBlock(invoice.depositRequest));
  }

  if (selectedSet.has("termsNotes")) {
    const lines: string[] = [];
    if (invoice.termsAndConditions?.trim()) {
      lines.push("Terms and conditions", invoice.termsAndConditions.trim());
    }
    if (invoice.notes?.trim()) {
      if (lines.length) lines.push("");
      lines.push("Notes", invoice.notes.trim());
    }
    if (lines.length) parts.push(lines.join("\n"));
  }

  return joinSections(parts);
}

export function formatJobCopyText(
  booking: BookingDetail,
  selected: readonly JobCopySectionId[],
  timeZone?: string | null,
): string {
  const selectedSet = new Set(selected);
  const parts: string[] = [];

  if (selectedSet.has("client")) {
    parts.push(formatClientBlock(booking.customer, booking.address));
  }

  if (selectedSet.has("service")) {
    const lines = ["Service"];
    if (booking.requestType === "existing_service") {
      if (booking.serviceName?.trim()) {
        lines.push(booking.serviceName.trim());
      }
      if (booking.serviceBusinessType?.trim()) {
        lines.push(booking.serviceBusinessType.trim());
      }
    } else {
      if (booking.customRequest?.title?.trim()) {
        lines.push(booking.customRequest.title.trim());
      }
      if (booking.customRequest?.description?.trim()) {
        lines.push(booking.customRequest.description.trim());
      }
    }
    parts.push(lines.join("\n"));
  }

  if (selectedSet.has("schedule")) {
    const days = bookingScheduleDays(booking);
    const lines = [
      days.length > 1 ? `Schedule · ${days.length} days` : "Schedule",
    ];
    days.forEach((day, index) => {
      const dayLabel =
        days.length > 1 ? `Day ${index + 1}: ` : "";
      const dateLabel = formatSlotDate(day.date, timeZone);
      const window = formatVisitWindow(day.startTime, day.endTime);
      const timeLabel =
        window ??
        (day.slot.timeRange ? TIME_RANGE_LABELS[day.slot.timeRange] : null);
      lines.push(
        `${dayLabel}${dateLabel}${timeLabel ? ` · ${timeLabel}` : ""}`,
      );
    });
    if (days.length > 0) parts.push(lines.join("\n"));
  }

  if (selectedSet.has("notesInstructions")) {
    const lines: string[] = [];
    if (booking.ownerNote?.trim()) {
      lines.push("Note for customer", booking.ownerNote.trim());
    }
    if (booking.jobInstructionsDescription?.trim()) {
      if (lines.length) lines.push("");
      lines.push(
        "Job instructions",
        booking.jobInstructionsDescription.trim(),
      );
    }
    if (booking.jobInstructionsTasks.length > 0) {
      if (lines.length) lines.push("");
      if (!booking.jobInstructionsDescription?.trim()) {
        lines.push("Job instructions");
      }
      for (const task of booking.jobInstructionsTasks) {
        const trimmed = task.trim();
        if (trimmed) lines.push(`- ${trimmed}`);
      }
    }
    if (lines.length) parts.push(lines.join("\n"));
  }

  if (selectedSet.has("assignment") && booking.assignedTo) {
    const lines = ["Assignment", booking.assignedTo.name];
    if (booking.assignedTo.email?.trim()) {
      lines.push(booking.assignedTo.email.trim());
    }
    parts.push(lines.join("\n"));
  }

  return joinSections(parts);
}
