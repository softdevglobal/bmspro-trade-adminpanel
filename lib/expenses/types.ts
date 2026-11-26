/**
 * Expense records: shared types, labels and settings.
 *
 * Staff and owners photograph a receipt; Sophie reads it and prepares a draft
 * expense. People decide everything after that: the submitter checks and
 * submits it, and the owner (or the accounts team) approves, rejects and
 * records reimbursements. Sophie never pays anyone or moves money.
 *
 * Used by the server, the API routes and the dashboard (no server imports).
 */

export const EXPENSE_COLLECTION = "expenses";
export const EXPENSE_REPORT_COLLECTION = "expense_reports";

export const EXPENSE_STATUSES = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "incomplete",
] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: "Draft",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  incomplete: "Incomplete",
};

export const EXPENSE_CATEGORIES = [
  "fuel",
  "materials",
  "tools",
  "vehicle",
  "parking_tolls",
  "travel_meals",
  "subcontractor",
  "office",
  "phone_internet",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  fuel: "Fuel",
  materials: "Materials & parts",
  tools: "Tools & equipment",
  vehicle: "Vehicle costs",
  parking_tolls: "Parking & tolls",
  travel_meals: "Travel & meals",
  subcontractor: "Subcontractors",
  office: "Office & admin",
  phone_internet: "Phone & internet",
  other: "Other",
};

/** Categories where the submitter's own vehicle is the likely link. */
export const VEHICLE_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set([
  "fuel",
  "vehicle",
  "parking_tolls",
]);

/** "business": paid with a business card or account. "personal": the person paid and is owed the money back. */
export type ExpensePaidWith = "business" | "personal";

export type ExpenseMissingField = "receipt" | "vendor" | "date" | "amount";

export const EXPENSE_MISSING_LABELS: Record<ExpenseMissingField, string> = {
  receipt: "Receipt",
  vendor: "Shop or supplier",
  date: "Date",
  amount: "Amount",
};

export type ExpensePerson = {
  uid: string;
  name: string;
  role: "owner" | "staff";
};

export type ExpenseReceipt = {
  url: string;
  path: string;
  contentType: string;
  /** SHA-256 of the image bytes, for exact duplicate checks. */
  sha256: string;
};

export type ExpenseSophieReading = {
  /** False when Sophie could not read the receipt (no AI configured or the call failed). */
  analysed: boolean;
  confidence: "high" | "medium" | "low" | null;
  /** Short notes for the submitter to confirm (blurry total, GST worked out, …). */
  checks: string[];
  analysedAt: number | null;
};

export type ExpenseReimbursement = {
  status: "not_needed" | "owed" | "reimbursed";
  /** Who recorded the reimbursement (a person, never Sophie). */
  by: { uid: string; name: string } | null;
  at: number | null;
  note: string | null;
};

export type ExpenseReceiptRequest = {
  requestedAt: number;
  requestedBy: { uid: string; name: string } | null;
  note: string | null;
  remindersSent: number;
  lastReminderAt: number | null;
};

export type ExpenseRecord = {
  id: string;
  businessId: string;
  expenseCode: string;
  status: ExpenseStatus;
  vendor: string | null;
  /** Purchase date, `YYYY-MM-DD`. */
  date: string | null;
  /** Total paid, including GST. */
  amountAud: number | null;
  gstAud: number | null;
  category: ExpenseCategory;
  reason: string | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
  jobId: string | null;
  jobLabel: string | null;
  paidWith: ExpensePaidWith;
  receipt: ExpenseReceipt | null;
  submittedBy: ExpensePerson;
  sophie: ExpenseSophieReading | null;
  missing: ExpenseMissingField[];
  /** True when the amount is above the business's spending limit (owner approval needed). */
  overLimit: boolean;
  limitAud: number | null;
  /** Set when the submitter confirmed this is not a duplicate of a similar expense. */
  duplicateOfId: string | null;
  decision: {
    by: { uid: string; name: string };
    at: number;
    note: string | null;
  } | null;
  reimbursement: ExpenseReimbursement;
  receiptRequest: ExpenseReceiptRequest | null;
  submittedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

/** Another expense a new receipt matches (returned with a 409). */
export type ExpenseDuplicate = {
  id: string;
  expenseCode: string;
  vendor: string | null;
  date: string | null;
  amountAud: number | null;
  status: ExpenseStatus;
  submittedByName: string;
  /** Exactly the same image file: never a different purchase, so it cannot be overridden. */
  exact: boolean;
};

export type ExpenseVehicle = {
  id: string;
  name: string;
  rego: string | null;
  /** Team member who usually drives it; their fuel and parking receipts link to it. */
  staffUid: string | null;
};

export type ExpenseSettings = {
  /** Expenses above this need the owner's approval. Null means no limit. */
  spendingLimitAud: number | null;
  /** Gets the weekly and monthly reports by email, with the owner. */
  accountantEmail: string | null;
  vehicles: ExpenseVehicle[];
  weeklyReport: boolean;
  monthlyReport: boolean;
};

export const DEFAULT_SPENDING_LIMIT_AUD = 300;
export const MAX_VEHICLES = 50;
export const MAX_EXPENSE_AUD = 100_000;

export const DEFAULT_EXPENSE_SETTINGS: ExpenseSettings = {
  spendingLimitAud: DEFAULT_SPENDING_LIMIT_AUD,
  accountantEmail: null,
  vehicles: [],
  weeklyReport: true,
  monthlyReport: true,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Reads `expenseSettings` from a business document, filling in defaults. */
export function parseExpenseSettings(raw: unknown): ExpenseSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_EXPENSE_SETTINGS, vehicles: [] };
  const data = raw as Record<string, unknown>;
  const limit = data.spendingLimitAud;
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  return {
    spendingLimitAud:
      limit === null
        ? null
        : typeof limit === "number" && Number.isFinite(limit) && limit >= 0
          ? Math.round(limit * 100) / 100
          : DEFAULT_SPENDING_LIMIT_AUD,
    accountantEmail:
      typeof data.accountantEmail === "string" && EMAIL_PATTERN.test(data.accountantEmail.trim())
        ? data.accountantEmail.trim().toLowerCase()
        : null,
    vehicles: vehicles.flatMap((entry): ExpenseVehicle[] => {
      if (!entry || typeof entry !== "object") return [];
      const vehicle = entry as Record<string, unknown>;
      const id = cleanText(vehicle.id, 64);
      const name = cleanText(vehicle.name, 60);
      if (!id || !name) return [];
      return [{
        id,
        name,
        rego: cleanText(vehicle.rego, 12)?.toUpperCase() ?? null,
        staffUid: cleanText(vehicle.staffUid, 128),
      }];
    }).slice(0, MAX_VEHICLES),
    weeklyReport: data.weeklyReport !== false,
    monthlyReport: data.monthlyReport !== false,
  };
}

/**
 * Validates an owner's settings update. Only the keys present are changed.
 */
export function normalizeExpenseSettingsPatch(
  raw: unknown,
  current: ExpenseSettings,
): { ok: true; value: ExpenseSettings } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid expense settings." };
  const input = raw as Record<string, unknown>;
  const next: ExpenseSettings = { ...current, vehicles: [...current.vehicles] };

  if ("spendingLimitAud" in input) {
    const value = input.spendingLimitAud;
    if (value === null || value === "") {
      next.spendingLimitAud = null;
    } else {
      const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(amount) || amount < 0 || amount > MAX_EXPENSE_AUD) {
        return { ok: false, error: "Enter a spending limit between $0 and $100,000, or leave it empty for no limit." };
      }
      next.spendingLimitAud = Math.round(amount * 100) / 100;
    }
  }

  if ("accountantEmail" in input) {
    const value = input.accountantEmail;
    if (value === null || (typeof value === "string" && !value.trim())) {
      next.accountantEmail = null;
    } else if (typeof value === "string" && EMAIL_PATTERN.test(value.trim()) && value.trim().length <= 200) {
      next.accountantEmail = value.trim().toLowerCase();
    } else {
      return { ok: false, error: "Enter a valid accountant email address." };
    }
  }

  if ("vehicles" in input) {
    if (!Array.isArray(input.vehicles)) return { ok: false, error: "Vehicles must be a list." };
    if (input.vehicles.length > MAX_VEHICLES) return { ok: false, error: `Add up to ${MAX_VEHICLES} vehicles.` };
    const seen = new Set<string>();
    const vehicles: ExpenseVehicle[] = [];
    for (const entry of input.vehicles) {
      const vehicle = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const name = cleanText(vehicle.name, 60);
      if (!name) return { ok: false, error: "Every vehicle needs a name." };
      let id = cleanText(vehicle.id, 64) ?? "";
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) id = `veh_${Math.random().toString(36).slice(2, 10)}`;
      if (seen.has(id)) id = `${id.slice(0, 50)}_${vehicles.length}`;
      seen.add(id);
      vehicles.push({
        id,
        name,
        rego: cleanText(vehicle.rego, 12)?.toUpperCase() ?? null,
        staffUid: cleanText(vehicle.staffUid, 128),
      });
    }
    next.vehicles = vehicles;
  }

  for (const key of ["weeklyReport", "monthlyReport"] as const) {
    if (key in input) {
      if (typeof input[key] !== "boolean") return { ok: false, error: "Report settings must be on or off." };
      next[key] = input[key] as boolean;
    }
  }

  return { ok: true, value: next };
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function isExpenseStatus(value: unknown): value is ExpenseStatus {
  return typeof value === "string" && (EXPENSE_STATUSES as readonly string[]).includes(value);
}

export function formatExpenseAud(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Groups the accountant reviews: drafts are still with the submitter. */
export const ACCOUNTANT_STATUS_ORDER: ExpenseStatus[] = [
  "pending",
  "incomplete",
  "approved",
  "rejected",
];
