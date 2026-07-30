import {
  formatInPlatformTimeZone,
  formatIsoDateInPlatformTimeZone,
} from "@/lib/platform/timezone";

export type ExportCell = string | number | boolean | null | undefined;

export type ExportRow = Record<string, ExportCell>;

function csvEscape(value: ExportCell): string {
  const normalized =
    value == null ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  if (
    normalized.includes(",") ||
    normalized.includes('"') ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildCsv(rows: ExportRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function buildCsvWithHeaders(
  headers: string[],
  rows: ExportRow[] = [],
): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header])).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

/** Parses a CSV string into objects keyed by the header row. */
export function parseCsv(text: string): ExportRow[] {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!normalized.trim()) return [];

  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      current.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  const nonEmpty = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map((header) => header.trim());
  return nonEmpty.slice(1).map((row) => {
    const record: ExportRow = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = (row[index] ?? "").trim();
    });
    return record;
  });
}

export function cellString(row: ExportRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function parseMoneyCell(value: ExportCell): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value)
    .replace(/Aus\s*\$/gi, "")
    .replace(/AUD/gi, "")
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function exportRowsAsCsv(rows: ExportRow[], filename: string) {
  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, filename);
}

export function formatExportTimestamp(
  value: number | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return "";
  return formatInPlatformTimeZone(
    value,
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    },
    timeZone,
  );
}

export function formatExportDate(
  value: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return "";
  return formatIsoDateInPlatformTimeZone(
    value,
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
    timeZone,
  );
}

export function formatExportMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function joinExportValues(
  values: Array<string | null | undefined>,
  separator = " | ",
): string {
  return values.map((value) => value?.trim()).filter(Boolean).join(separator);
}
