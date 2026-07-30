import type { ExportDatasetKey } from "@/lib/export/business-data";
import {
  buildCsvWithHeaders,
  cellString,
  parseMoneyCell,
  type ExportRow,
} from "@/lib/export/tabular";
import type { InspectionAddress } from "@/lib/inspection/types";
import { platformTodayIso } from "@/lib/platform/timezone";
import { toAuLocalPhoneDigits } from "@/lib/phone/au-phone";

export const IMPORT_MAX_ROWS = 100;

export const IMPORT_DATASET_HEADERS: Record<ExportDatasetKey, string[]> = {
  customers: ["Customer", "Email", "Phone"],
  requests: ["Customer", "Email", "Phone", "Service", "Budget"],
  quotations: [
    "Customer",
    "Email",
    "Phone",
    "Service",
    "Description",
    "Final Price",
  ],
  jobs: [
    "Customer",
    "Email",
    "Phone",
    "Service",
    "Scheduled Date",
    "Start Time",
    "End Time",
  ],
  invoices: [
    "Customer",
    "Email",
    "Phone",
    "Service",
    "Total",
    "Invoice Date",
    "Due Date",
  ],
};

export const IMPORT_DATASET_HINTS: Record<ExportDatasetKey, string> = {
  customers: "Requires Customer, Email, and Phone.",
  requests:
    "Requires Customer, Email, Phone, and Service. Address and Customer Notes are optional if you add them. Preferred visit defaults to tomorrow morning if no schedule is provided.",
  quotations:
    "Requires Customer, Email, Phone, Service, and Final Price. Address and Notes are optional. Creates a draft standalone quotation with one line item.",
  jobs: "Requires Customer, Email, Phone, and Service. Address and Customer Note are optional. Scheduled Date should be YYYY-MM-DD; Start/End Time default to 09:00–10:00.",
  invoices:
    "Requires Customer, Email, Phone, Service, and Total. Address and Notes are optional. Invoice/Due dates default to today / +14 days.",
};

export function buildImportTemplateCsv(dataset: ExportDatasetKey): string {
  return buildCsvWithHeaders(IMPORT_DATASET_HEADERS[dataset]);
}

export function guessDatasetFromFilename(
  filename: string,
): ExportDatasetKey | null {
  const lower = filename.toLowerCase();
  if (lower.includes("customer")) return "customers";
  if (lower.includes("request")) return "requests";
  if (lower.includes("quotation") || lower.includes("quote")) return "quotations";
  if (lower.includes("job") || lower.includes("booking")) return "jobs";
  if (lower.includes("invoice")) return "invoices";
  return null;
}

export type ParsedImportCustomer = {
  fullName: string;
  email: string;
  phone: string;
};

export type ParsedImportAddress = InspectionAddress;

function parseIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const au = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (au) {
    const day = au[1].padStart(2, "0");
    const month = au[2].padStart(2, "0");
    return `${au[3]}-${month}-${day}`;
  }
  return null;
}

function parseClock(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) return trimmed;
  const loose = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!loose) return fallback;
  let hour = Number.parseInt(loose[1], 10);
  const minute = Number.parseInt(loose[2] ?? "0", 10);
  const meridiem = loose[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseImportCustomer(
  row: ExportRow,
): { ok: true; value: ParsedImportCustomer } | { ok: false; error: string } {
  const fullName = cellString(row, "Customer", "Name", "Full Name");
  const email = cellString(row, "Email").toLowerCase();
  const phone = toAuLocalPhoneDigits(cellString(row, "Phone", "Mobile"));

  if (fullName.length < 2) {
    return { ok: false, error: "Customer name is required." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "A valid email is required." };
  }
  if (phone.length < 6) {
    return { ok: false, error: "A valid phone number is required." };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
    },
  };
}

export function parseImportAddress(row: ExportRow): ParsedImportAddress {
  const street = cellString(row, "Street", "Address Street");
  const suburb = cellString(row, "Suburb", "Address Suburb");
  const state = cellString(row, "State", "Address State");
  const postcode = cellString(row, "Postcode", "Address Postcode", "Post Code");

  if (street || suburb || state || postcode) {
    return { street, suburb, state, postcode };
  }

  const combined = cellString(row, "Address");
  if (!combined) {
    return { street: "", suburb: "", state: "", postcode: "" };
  }

  const parts = combined
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { street: "", suburb: "", state: "", postcode: "" };
  }

  let nextPostcode = "";
  let nextState = "";
  let nextSuburb = "";
  let nextStreet = "";

  const last = parts[parts.length - 1] ?? "";
  if (/^\d{3,4}$/.test(last)) {
    nextPostcode = last;
    parts.pop();
  }

  if (parts.length > 0) {
    const maybeState = parts[parts.length - 1] ?? "";
    if (maybeState.length <= 3) {
      nextState = maybeState;
      parts.pop();
    }
  }

  if (parts.length > 0) {
    nextSuburb = parts[parts.length - 1] ?? "";
    parts.pop();
  }

  nextStreet = parts.join(", ");

  return {
    street: nextStreet,
    suburb: nextSuburb,
    state: nextState,
    postcode: nextPostcode,
  };
}

export function parseImportServiceTitle(row: ExportRow): string {
  return (
    cellString(row, "Service", "Service Title", "Title", "Latest Service") ||
    "Imported work"
  );
}

export function parseImportMoney(
  row: ExportRow,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = parseMoneyCell(row[key]);
    if (value != null) return value;
  }
  return null;
}

export function parseImportSchedule(
  row: ExportRow,
  timeZone?: string | null,
): {
  date: string;
  startTime: string;
  endTime: string;
} {
  const today = platformTodayIso(new Date(), timeZone);
  const tomorrow = addDaysIso(today, 1);
  const date =
    parseIsoDate(cellString(row, "Scheduled Date", "Inspection Date")) ??
    tomorrow;
  const startTime = parseClock(cellString(row, "Start Time"), "09:00");
  const endTime = parseClock(cellString(row, "End Time"), "10:00");
  return { date, startTime, endTime };
}

export function parseImportInvoiceDates(
  row: ExportRow,
  timeZone?: string | null,
): { invoiceDate: string; dueDate: string } {
  const today = platformTodayIso(new Date(), timeZone);
  const invoiceDate =
    parseIsoDate(cellString(row, "Invoice Date")) ?? today;
  const dueDate =
    parseIsoDate(cellString(row, "Due Date")) ?? addDaysIso(invoiceDate, 14);
  return { invoiceDate, dueDate };
}

export function detectDatasetFromHeaders(
  rows: ExportRow[],
): ExportDatasetKey | null {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]).map((header) => header.toLowerCase());
  const has = (name: string) => headers.some((header) => header.includes(name));

  if (has("invoice date") || has("due date") || has("total")) return "invoices";
  if (has("scheduled date") || has("start time")) return "jobs";
  if (has("final price") || has("valid until")) return "quotations";
  if (has("customer notes") || has("budget") || has("preferred")) return "requests";
  if (has("email") && has("phone") && has("customer")) return "customers";
  return null;
}
