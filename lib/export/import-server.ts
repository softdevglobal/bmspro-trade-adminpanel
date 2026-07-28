import "server-only";

import { actorRoleFromClaim } from "@/lib/audit/types";
import { logAuditEvent } from "@/lib/audit/server";
import { createDirectJob } from "@/lib/bookings/server";
import { estimateMinutesFromTimeRange } from "@/lib/bookings/job-estimate";
import { ensureCustomerAccount } from "@/lib/customer/server";
import type { ExportDatasetKey } from "@/lib/export/business-data";
import {
  IMPORT_MAX_ROWS,
  parseImportAddress,
  parseImportCustomer,
  parseImportInvoiceDates,
  parseImportMoney,
  parseImportSchedule,
  parseImportServiceTitle,
} from "@/lib/export/import-shared";
import type { ExportRow } from "@/lib/export/tabular";
import { adminDb } from "@/lib/firebase/admin";
import { createInspectionRequest } from "@/lib/inspection/server";
import {
  timeRangeFromStartTime,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { createDirectInvoice } from "@/lib/invoices/server";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import { createStandaloneQuotation } from "@/lib/quotations/server";

export type ImportRowResult = {
  row: number;
  ok: boolean;
  error?: string;
  id?: string;
  label?: string;
};

export type ImportDatasetResult = {
  dataset: ExportDatasetKey;
  imported: number;
  failed: number;
  results: ImportRowResult[];
};

type ImportAuth = {
  uid: string;
  email: string | null;
  name: string | null;
  role: string | null;
  businessId: string;
};

async function loadBusinessMeta(businessId: string) {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  const data = snap.data() ?? {};
  return {
    businessName:
      typeof data.businessName === "string" ? data.businessName : null,
    bookingSlug:
      typeof data.bookingSlug === "string" ? data.bookingSlug : null,
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
    timeZone:
      typeof data.timezone === "string" && data.timezone.trim()
        ? data.timezone.trim()
        : PLATFORM_TIME_ZONE,
  };
}

async function importCustomerRow(
  auth: ImportAuth,
  meta: Awaited<ReturnType<typeof loadBusinessMeta>>,
  row: ExportRow,
  rowNumber: number,
): Promise<ImportRowResult> {
  const customer = parseImportCustomer(row);
  if (!customer.ok) {
    return { row: rowNumber, ok: false, error: customer.error };
  }

  try {
    const account = await ensureCustomerAccount({
      email: customer.value.email,
      fullName: customer.value.fullName,
      phone: customer.value.phone,
      businessId: auth.businessId,
      businessName: meta.businessName,
      bookingSlug: meta.bookingSlug,
      logoUrl: meta.logoUrl,
      context: "inspection",
      sendWelcomeEmail: false,
    });

    if (account.created) {
      await logAuditEvent({
        businessId: auth.businessId,
        category: "customer",
        action: "customer.created",
        actor: {
          uid: auth.uid,
          role: actorRoleFromClaim(auth.role),
          name: auth.name,
          email: auth.email,
        },
        source: "admin_panel",
        summary: `Customer ${customer.value.fullName} imported from CSV`,
        targetId: account.uid,
        targetLabel: customer.value.fullName,
        metadata: { via: "csv_import" },
      });
    }

    return {
      row: rowNumber,
      ok: true,
      id: account.uid,
      label: customer.value.fullName,
    };
  } catch (error) {
    return {
      row: rowNumber,
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not import customer.",
    };
  }
}

async function importRequestRow(
  auth: ImportAuth,
  meta: Awaited<ReturnType<typeof loadBusinessMeta>>,
  row: ExportRow,
  rowNumber: number,
): Promise<ImportRowResult> {
  const customer = parseImportCustomer(row);
  if (!customer.ok) {
    return { row: rowNumber, ok: false, error: customer.error };
  }

  const serviceTitle = parseImportServiceTitle(row);
  const address = parseImportAddress(row);
  const schedule = parseImportSchedule(row, meta.timeZone);
  const preferredSlot: InspectionSlot = {
    date: schedule.date,
    timeRange: timeRangeFromStartTime(schedule.startTime),
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };

  let customerId: string | null = null;
  try {
    const account = await ensureCustomerAccount({
      email: customer.value.email,
      fullName: customer.value.fullName,
      phone: customer.value.phone,
      businessId: auth.businessId,
      businessName: meta.businessName,
      bookingSlug: meta.bookingSlug,
      logoUrl: meta.logoUrl,
      context: "inspection",
      sendWelcomeEmail: false,
    });
    customerId = account.uid;
  } catch {
    /* continue without linked account */
  }

  const result = await createInspectionRequest(
    auth.businessId,
    {
      requestType: "custom_quote",
      serviceId: null,
      customRequest: {
        title: serviceTitle,
        description: cellOrEmpty(row, "Customer Notes", "Description"),
      },
      customer: customer.value,
      address,
      preferredSlots: [preferredSlot],
      customerNotes: cellOrEmpty(row, "Customer Notes") || null,
      budgetAud: parseImportMoney(row, "Budget"),
      customerImageUrls: [],
    },
    {
      customerId,
      createdSource: "owner_dashboard",
    },
  );

  if (!result.ok) {
    return { row: rowNumber, ok: false, error: result.error };
  }

  return {
    row: rowNumber,
    ok: true,
    id: result.request.id,
    label: result.request.requestCode ?? serviceTitle,
  };
}

async function importQuotationRow(
  auth: ImportAuth,
  row: ExportRow,
  rowNumber: number,
): Promise<ImportRowResult> {
  const customer = parseImportCustomer(row);
  if (!customer.ok) {
    return { row: rowNumber, ok: false, error: customer.error };
  }

  const serviceTitle = parseImportServiceTitle(row);
  const finalPrice =
    parseImportMoney(row, "Final Price", "Total", "Quotation Total") ?? 0;
  if (finalPrice <= 0) {
    return {
      row: rowNumber,
      ok: false,
      error: "Final Price must be greater than 0.",
    };
  }

  const result = await createStandaloneQuotation(auth.businessId, auth.uid, {
    customer: customer.value,
    address: parseImportAddress(row),
    title: serviceTitle,
    description: cellOrEmpty(row, "Description") || null,
    requestType: "custom_quote",
    customRequest: {
      title: serviceTitle,
      description: cellOrEmpty(row, "Description"),
    },
    lineItems: [{ name: serviceTitle, priceAud: finalPrice, quantity: 1 }],
    finalPriceAud: finalPrice,
    notes: cellOrEmpty(row, "Notes") || null,
    send: false,
  });

  if (!result.ok) {
    return { row: rowNumber, ok: false, error: result.error };
  }

  return {
    row: rowNumber,
    ok: true,
    id: result.quotation.id,
    label: result.quotation.quotationCode ?? serviceTitle,
  };
}

async function importJobRow(
  auth: ImportAuth,
  meta: Awaited<ReturnType<typeof loadBusinessMeta>>,
  row: ExportRow,
  rowNumber: number,
): Promise<ImportRowResult> {
  const customer = parseImportCustomer(row);
  if (!customer.ok) {
    return { row: rowNumber, ok: false, error: customer.error };
  }

  const serviceTitle = parseImportServiceTitle(row);
  const schedule = parseImportSchedule(row, meta.timeZone);
  const slot: InspectionSlot = {
    date: schedule.date,
    timeRange: timeRangeFromStartTime(schedule.startTime),
    startTime: schedule.startTime,
    endTime: schedule.endTime,
  };

  const result = await createDirectJob(
    auth.businessId,
    auth.uid,
    {
      requestType: "custom_quote",
      serviceId: null,
      customRequest: {
        title: serviceTitle,
        description: cellOrEmpty(row, "Customer Note", "Description"),
      },
      customer: customer.value,
      address: parseImportAddress(row),
      customerNotes: cellOrEmpty(row, "Customer Note") || null,
      budgetAud: null,
      slot,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      estimatedDurationMinutes: estimateMinutesFromTimeRange(
        schedule.startTime,
        schedule.endTime,
      ),
      note: cellOrEmpty(row, "Customer Note") || null,
    },
    {
      actor: {
        uid: auth.uid,
        role: actorRoleFromClaim(auth.role),
        name: auth.name,
        email: auth.email,
      },
      source: "admin_panel",
    },
  );

  if (!result.ok) {
    return { row: rowNumber, ok: false, error: result.error };
  }

  return {
    row: rowNumber,
    ok: true,
    id: result.booking.id,
    label: result.booking.bookingCode ?? serviceTitle,
  };
}

async function importInvoiceRow(
  auth: ImportAuth,
  meta: Awaited<ReturnType<typeof loadBusinessMeta>>,
  row: ExportRow,
  rowNumber: number,
): Promise<ImportRowResult> {
  const customer = parseImportCustomer(row);
  if (!customer.ok) {
    return { row: rowNumber, ok: false, error: customer.error };
  }

  const serviceTitle = parseImportServiceTitle(row);
  const total = parseImportMoney(row, "Total", "Final Price") ?? 0;
  if (total <= 0) {
    return {
      row: rowNumber,
      ok: false,
      error: "Total must be greater than 0.",
    };
  }

  const dates = parseImportInvoiceDates(row, meta.timeZone);
  const result = await createDirectInvoice(auth.businessId, auth.uid, {
    customer: customer.value,
    address: parseImportAddress(row),
    serviceTitle,
    description: cellOrEmpty(row, "Notes", "Description") || null,
    requestType: "custom_quote",
    customRequest: {
      title: serviceTitle,
      description: cellOrEmpty(row, "Notes", "Description"),
    },
    lineItems: [{ name: serviceTitle, priceAud: total, quantity: 1 }],
    finalPriceAud: total,
    notes: cellOrEmpty(row, "Notes") || null,
    invoiceDate: dates.invoiceDate,
    dueDate: dates.dueDate,
    send: false,
  });

  if (!result.ok) {
    return { row: rowNumber, ok: false, error: result.error };
  }

  return {
    row: rowNumber,
    ok: true,
    id: result.invoice.id,
    label: result.invoice.invoiceCode,
  };
}

function cellOrEmpty(row: ExportRow, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export async function importBusinessDataset(options: {
  auth: ImportAuth;
  dataset: ExportDatasetKey;
  rows: ExportRow[];
}): Promise<ImportDatasetResult> {
  const { auth, dataset } = options;
  const rows = options.rows.slice(0, IMPORT_MAX_ROWS);
  const meta = await loadBusinessMeta(auth.businessId);
  const results: ImportRowResult[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2; // account for header row
    let result: ImportRowResult;

    switch (dataset) {
      case "customers":
        result = await importCustomerRow(auth, meta, row, rowNumber);
        break;
      case "requests":
        result = await importRequestRow(auth, meta, row, rowNumber);
        break;
      case "quotations":
        result = await importQuotationRow(auth, row, rowNumber);
        break;
      case "jobs":
        result = await importJobRow(auth, meta, row, rowNumber);
        break;
      case "invoices":
        result = await importInvoiceRow(auth, meta, row, rowNumber);
        break;
      default:
        result = {
          row: rowNumber,
          ok: false,
          error: "Unsupported dataset.",
        };
    }

    results.push(result);
  }

  const imported = results.filter((entry) => entry.ok).length;
  const failed = results.length - imported;

  const categoryByDataset = {
    customers: "customer",
    requests: "inspection",
    quotations: "quotation",
    jobs: "booking",
    invoices: "invoice",
  } as const;

  await logAuditEvent({
    businessId: auth.businessId,
    category: categoryByDataset[dataset],
    action: `${categoryByDataset[dataset]}.csv_imported`,
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: auth.name,
      email: auth.email,
    },
    source: "admin_panel",
    summary: `Imported ${imported} ${dataset} row(s) from CSV (${failed} failed)`,
    metadata: {
      dataset,
      imported,
      failed,
      total: results.length,
    },
  });

  return {
    dataset,
    imported,
    failed,
    results,
  };
}
