"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import type { BookingDetail } from "@/lib/bookings/types";
import {
  buildCustomersExportRows,
  buildInvoicesExportRows,
  buildJobsExportRows,
  buildQuotationsExportRows,
  buildRequestsExportRows,
  EXPORT_DATASET_LABELS,
  type ExportDatasetKey,
} from "@/lib/export/business-data";
import {
  buildImportTemplateCsv,
  detectDatasetFromHeaders,
  guessDatasetFromFilename,
  IMPORT_DATASET_HINTS,
  IMPORT_MAX_ROWS,
} from "@/lib/export/import-shared";
import {
  buildCsv,
  downloadBlob,
  parseCsv,
  type ExportRow,
} from "@/lib/export/tabular";
import type { InvoiceDetail } from "@/lib/invoices/types";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import { platformTodayIso } from "@/lib/platform/timezone";
import type { QuotationDetail } from "@/lib/quotations/types";
import JSZip from "jszip";
import { useMemo, useRef, useState } from "react";

type ExportSelection = Record<ExportDatasetKey, boolean>;

type ImportResultSummary = {
  dataset: ExportDatasetKey;
  imported: number;
  failed: number;
  results: Array<{
    row: number;
    ok: boolean;
    error?: string;
    id?: string;
    label?: string;
  }>;
};

const EXPORT_OPTIONS: Array<{
  key: ExportDatasetKey;
  icon: string;
  description: string;
}> = [
  {
    key: "requests",
    icon: "event_available",
    description: "Inspection requests and linked quotation, job, and invoice references.",
  },
  {
    key: "quotations",
    icon: "request_quote",
    description: "Quotation totals, customer decisions, and follow-up links.",
  },
  {
    key: "jobs",
    icon: "assignment",
    description: "Scheduled jobs, timing, assignment, and instruction details.",
  },
  {
    key: "invoices",
    icon: "receipt_long",
    description: "Invoice amounts, balances, dates, and payment status.",
  },
  {
    key: "customers",
    icon: "groups",
    description: "Customer summaries built from request history and linked work.",
  },
];

const DEFAULT_SELECTION: ExportSelection = {
  requests: true,
  quotations: true,
  jobs: true,
  invoices: true,
  customers: true,
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? fallback);
  }
  return payload;
}

export function BusinessDataExportSettings() {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const timeZone = profile?.timezone ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selection, setSelection] = useState<ExportSelection>(DEFAULT_SELECTION);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const [importDataset, setImportDataset] = useState<ExportDatasetKey>("customers");
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ExportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResultSummary | null>(null);

  const selectedCount = useMemo(
    () => Object.values(selection).filter(Boolean).length,
    [selection],
  );

  function toggleSelection(key: ExportDatasetKey) {
    setSelection((current) => ({ ...current, [key]: !current[key] }));
    setExportError(null);
    setExportSuccess(null);
  }

  function downloadTemplate(dataset: ExportDatasetKey) {
    const csv = buildImportTemplateCsv(dataset);
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      `${dataset}-import-template.csv`,
    );
  }

  async function handleDownload() {
    if (!user) return;
    if (selectedCount === 0) {
      setExportError("Choose at least one dataset to export.");
      setExportSuccess(null);
      return;
    }

    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const token = await user.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const needRequests = selection.requests || selection.customers;
      const needQuotations = selection.quotations;
      const needJobs = selection.jobs || selection.customers;
      const needInvoices = selection.invoices || selection.customers;

      const [requestsResult, quotationsResult, jobsResult, invoicesResult] =
        await Promise.all([
          needRequests
            ? fetch("/api/requests", { headers, cache: "no-store" }).then(
                (response) =>
                  readJson<{ requests?: InspectionRequestDetail[] }>(
                    response,
                    "Could not load requests for export.",
                  ),
              )
            : Promise.resolve<{ requests?: InspectionRequestDetail[] }>({
                requests: [],
              }),
          needQuotations
            ? fetch("/api/quotations", { headers, cache: "no-store" }).then(
                (response) =>
                  readJson<{ quotations?: QuotationDetail[] }>(
                    response,
                    "Could not load quotations for export.",
                  ),
              )
            : Promise.resolve<{ quotations?: QuotationDetail[] }>({
                quotations: [],
              }),
          needJobs
            ? fetch("/api/jobs", { headers, cache: "no-store" }).then(
                (response) =>
                  readJson<{ jobs?: BookingDetail[] }>(
                    response,
                    "Could not load jobs for export.",
                  ),
              )
            : Promise.resolve<{ jobs?: BookingDetail[] }>({ jobs: [] }),
          needInvoices
            ? fetch("/api/invoices", { headers, cache: "no-store" }).then(
                (response) =>
                  readJson<{ invoices?: InvoiceDetail[] }>(
                    response,
                    "Could not load invoices for export.",
                  ),
              )
            : Promise.resolve<{ invoices?: InvoiceDetail[] }>({ invoices: [] }),
        ]);

      const requests = requestsResult.requests ?? [];
      const quotations = quotationsResult.quotations ?? [];
      const jobs = jobsResult.jobs ?? [];
      const invoices = invoicesResult.invoices ?? [];

      const zip = new JSZip();
      if (selection.requests) {
        zip.file(
          "requests.csv",
          buildCsv(buildRequestsExportRows(requests, jobs, timeZone)),
        );
      }
      if (selection.quotations) {
        zip.file(
          "quotations.csv",
          buildCsv(buildQuotationsExportRows(quotations, timeZone)),
        );
      }
      if (selection.jobs) {
        zip.file("jobs.csv", buildCsv(buildJobsExportRows(jobs, timeZone)));
      }
      if (selection.invoices) {
        zip.file(
          "invoices.csv",
          buildCsv(buildInvoicesExportRows(invoices, timeZone)),
        );
      }
      if (selection.customers) {
        zip.file(
          "customers.csv",
          buildCsv(
            buildCustomersExportRows(requests, jobs, invoices, timeZone),
          ),
        );
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const stamp = platformTodayIso(new Date(), timeZone);
      downloadBlob(zipBlob, `business-data-export-${stamp}.zip`);
      setExportSuccess(
        `ZIP export ready with ${selectedCount} file${selectedCount === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Could not create the export ZIP.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelected(file: File | null) {
    setImportError(null);
    setImportResult(null);
    setImportFileName(null);
    setImportRows([]);

    if (!file) return;

    try {
      const lower = file.name.toLowerCase();
      let csvText = "";
      let guessed: ExportDatasetKey | null = guessDatasetFromFilename(file.name);

      if (lower.endsWith(".zip")) {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        const csvEntry = Object.values(zip.files).find(
          (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv"),
        );
        if (!csvEntry) {
          throw new Error("The ZIP does not contain a CSV file.");
        }
        csvText = await csvEntry.async("string");
        guessed =
          guessDatasetFromFilename(csvEntry.name) ??
          guessDatasetFromFilename(file.name);
        setImportFileName(`${file.name} → ${csvEntry.name}`);
      } else if (lower.endsWith(".csv") || file.type.includes("csv")) {
        csvText = await file.text();
        setImportFileName(file.name);
      } else {
        throw new Error("Choose a .csv file or a .zip that contains CSV files.");
      }

      const rows = parseCsv(csvText);
      if (rows.length === 0) {
        throw new Error("No data rows found in the CSV.");
      }
      if (rows.length > IMPORT_MAX_ROWS) {
        throw new Error(
          `Import is limited to ${IMPORT_MAX_ROWS} rows at a time. Split the file and try again.`,
        );
      }

      const detected = detectDatasetFromHeaders(rows) ?? guessed;
      if (detected) setImportDataset(detected);
      setImportRows(rows);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Could not read the import file.",
      );
    }
  }

  async function handleImport() {
    if (!user) return;
    if (importRows.length === 0) {
      setImportError("Choose a CSV file to import first.");
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/data-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dataset: importDataset,
          rows: importRows,
        }),
      });
      const payload = (await response.json()) as ImportResultSummary & {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not import the CSV.");
      }
      setImportResult({
        dataset: payload.dataset,
        imported: payload.imported,
        failed: payload.failed,
        results: payload.results ?? [],
      });
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Could not import the CSV.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <SettingsSection
      title="Data export & import"
      description="Download selected records as a ZIP of CSVs, or import customers, requests, quotations, jobs, and invoices from a CSV template."
      icon="folder_zip"
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <div>
            <h4 className="font-body text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
              Export
            </h4>
            <p className="mt-1 font-body text-[13px] text-on-surface-variant">
              Choose which datasets to include, then download them together.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {EXPORT_OPTIONS.map((option) => {
              const checked = selection[option.key];
              return (
                <label
                  key={option.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    checked
                      ? "border-primary/40 bg-primary/5"
                      : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelection(option.key)}
                    className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-body text-[14px] font-semibold text-on-surface">
                      <span className="material-symbols-outlined text-[18px] text-primary">
                        {option.icon}
                      </span>
                      {EXPORT_DATASET_LABELS[option.key]}
                    </span>
                    <span className="mt-1 block font-body text-[12px] leading-relaxed text-on-surface-variant">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-body text-[13px] text-on-surface-variant">
              {selectedCount} dataset{selectedCount === 1 ? "" : "s"} selected
              for export.
            </p>
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={exporting}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className={`material-symbols-outlined text-[18px] ${
                  exporting ? "animate-spin" : ""
                }`}
              >
                {exporting ? "progress_activity" : "download"}
              </span>
              {exporting ? "Preparing ZIP..." : "Download ZIP"}
            </button>
          </div>

          {exportError ? (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
            >
              {exportError}
            </p>
          ) : null}
          {exportSuccess ? (
            <p
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-body text-[13px] text-emerald-800"
            >
              {exportSuccess}
            </p>
          ) : null}
        </div>

        <div className="border-t border-outline-variant/50 pt-6">
          <div className="space-y-4">
            <div>
              <h4 className="font-body text-[13px] font-bold uppercase tracking-wider text-on-surface-variant">
                Import
              </h4>
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                Upload a CSV (or ZIP containing a CSV). Use the template for the
                dataset you want to create. Limit: {IMPORT_MAX_ROWS} rows per
                import.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="mb-1.5 block font-body text-[12px] font-semibold text-on-surface-variant">
                  Dataset to import
                </span>
                <div className="relative">
                  <select
                    value={importDataset}
                    onChange={(event) =>
                      setImportDataset(event.target.value as ExportDatasetKey)
                    }
                    className="w-full appearance-none rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 pr-9 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {(Object.keys(EXPORT_DATASET_LABELS) as ExportDatasetKey[]).map(
                      (key) => (
                        <option key={key} value={key}>
                          {EXPORT_DATASET_LABELS[key]}
                        </option>
                      ),
                    )}
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-outline">
                    expand_more
                  </span>
                </div>
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => downloadTemplate(importDataset)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container sm:w-auto"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    description
                  </span>
                  Download template
                </button>
              </div>
            </div>

            <p className="font-body text-[12px] text-on-surface-variant">
              {IMPORT_DATASET_HINTS[importDataset]}
            </p>

            <div className="rounded-xl border border-dashed border-outline-variant/70 bg-surface-container-low px-4 py-5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,application/zip,.zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void handleFileSelected(file);
                  event.target.value = "";
                }}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-body text-[14px] font-semibold text-on-surface">
                    {importFileName ?? "No file selected"}
                  </p>
                  <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                    {importRows.length > 0
                      ? `${importRows.length} row${importRows.length === 1 ? "" : "s"} ready to import as ${EXPORT_DATASET_LABELS[importDataset].toLowerCase()}.`
                      : "Choose a CSV or ZIP file to continue."}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      upload_file
                    </span>
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleImport()}
                    disabled={importing || importRows.length === 0}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      className={`material-symbols-outlined text-[18px] ${
                        importing ? "animate-spin" : ""
                      }`}
                    >
                      {importing ? "progress_activity" : "upload"}
                    </span>
                    {importing ? "Importing..." : "Import CSV"}
                  </button>
                </div>
              </div>
            </div>

            {importError ? (
              <p
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
              >
                {importError}
              </p>
            ) : null}

            {importResult ? (
              <div className="space-y-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-4">
                <p className="font-body text-[14px] font-semibold text-on-surface">
                  Imported {importResult.imported}{" "}
                  {EXPORT_DATASET_LABELS[importResult.dataset].toLowerCase()}
                  {importResult.failed > 0
                    ? ` · ${importResult.failed} failed`
                    : ""}
                </p>
                {importResult.results.some((entry) => !entry.ok) ? (
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {importResult.results
                      .filter((entry) => !entry.ok)
                      .map((entry) => (
                        <li
                          key={`row-${entry.row}`}
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
                        >
                          Row {entry.row}: {entry.error ?? "Import failed."}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="font-body text-[13px] text-emerald-800">
                    All rows imported successfully.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
