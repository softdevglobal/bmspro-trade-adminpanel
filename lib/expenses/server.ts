import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { logAuditEvent } from "@/lib/audit/server";
import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { parseBusinessModuleSettings } from "@/lib/business/module-settings";
import {
  notifyOwnerExpenseNeedsApproval,
  notifyStaffExpenseDecision,
  notifyStaffExpenseReimbursed,
  notifyStaffReceiptRequested,
} from "@/lib/expenses/notify";
import {
  readReceipt,
  receiptAnalysisConfig,
  type ReceiptContext,
  type ReceiptReading,
} from "@/lib/expenses/receipt-analysis";
import {
  addDaysIso,
  expenseFingerprint,
  isIsoDate,
  isOverSpendingLimit,
  missingExpenseFields,
  roundCents,
  statusAfterSubmit,
} from "@/lib/expenses/rules";
import {
  EXPENSE_COLLECTION,
  EXPENSE_MISSING_LABELS,
  MAX_EXPENSE_AUD,
  isExpenseCategory,
  isExpenseStatus,
  parseExpenseSettings,
  type ExpenseCategory,
  type ExpenseDuplicate,
  type ExpenseMissingField,
  type ExpensePaidWith,
  type ExpenseRecord,
  type ExpenseSettings,
  type ExpenseStatus,
} from "@/lib/expenses/types";
import { adminDb, adminStorage, getStorageBucketName } from "@/lib/firebase/admin";
import { platformTodayIso } from "@/lib/platform/timezone";
import { imageType } from "@/lib/security/file-types";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const LIST_LIMIT = 2000;
const RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ---------------------------------------------------------------------------
// Who is acting
// ---------------------------------------------------------------------------

export type ExpenseActor = {
  uid: string;
  email: string | null;
  businessId: string;
  role: "owner" | "admin" | "staff";
  name: string;
};

/** Owners and admins approve, reject and record reimbursements. */
export function isExpenseManager(actor: Pick<ExpenseActor, "role">): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

export async function resolveExpenseActor(auth: {
  uid: string;
  email?: string | null;
  businessId: string;
  role: string;
}): Promise<ExpenseActor | null> {
  const role = auth.role === "business_owner" ? "owner" : auth.role;
  if (role !== "owner" && role !== "admin" && role !== "staff") return null;
  let name = "";
  try {
    const snap = await adminDb.collection("users").doc(auth.uid).get();
    const data = snap.data() ?? {};
    name = typeof data.fullName === "string" ? data.fullName.trim() : "";
  } catch {
    /* fall back to the email below */
  }
  return {
    uid: auth.uid,
    email: auth.email ?? null,
    businessId: auth.businessId,
    role,
    name: name || auth.email?.split("@")[0] || (role === "staff" ? "Team member" : "Owner"),
  };
}

// ---------------------------------------------------------------------------
// Business context
// ---------------------------------------------------------------------------

export type ExpenseBusinessContext = {
  businessId: string;
  businessName: string | null;
  logoUrl: string | null;
  ownerUid: string | null;
  timeZone: string | null;
  expensesEnabled: boolean;
  settings: ExpenseSettings;
};

export function businessContextFromDoc(
  businessId: string,
  data: Record<string, unknown>,
): ExpenseBusinessContext {
  return {
    businessId,
    businessName: typeof data.businessName === "string" ? data.businessName : null,
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
    ownerUid: typeof data.ownerUid === "string" && data.ownerUid.trim() ? data.ownerUid.trim() : null,
    timeZone: typeof data.timezone === "string" && data.timezone.trim() ? data.timezone.trim() : null,
    expensesEnabled: parseBusinessModuleSettings(data).expenses,
    settings: parseExpenseSettings(data.expenseSettings),
  };
}

export async function loadExpenseBusiness(businessId: string): Promise<ExpenseBusinessContext | null> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) return null;
  return businessContextFromDoc(businessId, snap.data() ?? {});
}

export async function saveExpenseSettings(businessId: string, settings: ExpenseSettings): Promise<void> {
  await adminDb.collection("businesses").doc(businessId).update({
    expenseSettings: settings,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const millis = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
};
const personRef = (value: unknown) => {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const uid = str(data.uid);
  return uid ? { uid, name: str(data.name) ?? "Someone" } : null;
};

export function mapExpenseDoc(id: string, data: Record<string, unknown>): ExpenseRecord {
  const submittedBy = (data.submittedBy ?? {}) as Record<string, unknown>;
  const receipt = data.receipt && typeof data.receipt === "object" ? (data.receipt as Record<string, unknown>) : null;
  const sophie = data.sophie && typeof data.sophie === "object" ? (data.sophie as Record<string, unknown>) : null;
  const decision = data.decision && typeof data.decision === "object" ? (data.decision as Record<string, unknown>) : null;
  const reimbursement = (data.reimbursement ?? {}) as Record<string, unknown>;
  const request = data.receiptRequest && typeof data.receiptRequest === "object"
    ? (data.receiptRequest as Record<string, unknown>)
    : null;
  const decisionBy = personRef(decision?.by);
  return {
    id,
    businessId: str(data.businessId) ?? "",
    expenseCode: str(data.expenseCode) ?? `EXP-${id.slice(0, 6).toUpperCase()}`,
    status: isExpenseStatus(data.status) ? data.status : "draft",
    vendor: str(data.vendor),
    date: isIsoDate(data.date) ? data.date : null,
    amountAud: num(data.amountAud),
    gstAud: num(data.gstAud),
    category: isExpenseCategory(data.category) ? data.category : "other",
    reason: str(data.reason),
    vehicleId: str(data.vehicleId),
    vehicleLabel: str(data.vehicleLabel),
    jobId: str(data.jobId),
    jobLabel: str(data.jobLabel),
    paidWith: data.paidWith === "personal" ? "personal" : "business",
    receipt: receipt && str(receipt.url) && str(receipt.path)
      ? {
          url: str(receipt.url)!,
          path: str(receipt.path)!,
          contentType: str(receipt.contentType) ?? "image/jpeg",
          sha256: str(receipt.sha256) ?? "",
        }
      : null,
    submittedBy: {
      uid: str(submittedBy.uid) ?? "",
      name: str(submittedBy.name) ?? "Team member",
      role: submittedBy.role === "owner" ? "owner" : "staff",
    },
    sophie: sophie
      ? {
          analysed: sophie.analysed === true,
          confidence:
            sophie.confidence === "high" || sophie.confidence === "medium" || sophie.confidence === "low"
              ? sophie.confidence
              : null,
          checks: Array.isArray(sophie.checks)
            ? sophie.checks.filter((check): check is string => typeof check === "string").slice(0, 10)
            : [],
          analysedAt: millis(sophie.analysedAt),
        }
      : null,
    missing: Array.isArray(data.missing)
      ? data.missing.filter((field): field is ExpenseMissingField => typeof field === "string" && field in EXPENSE_MISSING_LABELS)
      : [],
    overLimit: data.overLimit === true,
    limitAud: num(data.limitAud),
    duplicateOfId: str(data.duplicateOfId),
    decision: decision && decisionBy
      ? { by: decisionBy, at: millis(decision.at) ?? 0, note: str(decision.note) }
      : null,
    reimbursement: {
      status:
        reimbursement.status === "owed" || reimbursement.status === "reimbursed"
          ? reimbursement.status
          : "not_needed",
      by: personRef(reimbursement.by),
      at: millis(reimbursement.at),
      note: str(reimbursement.note),
    },
    receiptRequest: request
      ? {
          requestedAt: millis(request.requestedAt) ?? 0,
          requestedBy: personRef(request.requestedBy),
          note: str(request.note),
          remindersSent: num(request.remindersSent) ?? 0,
          lastReminderAt: millis(request.lastReminderAt),
        }
      : null,
    submittedAt: millis(data.submittedAt),
    createdAt: millis(data.createdAt),
    updatedAt: millis(data.updatedAt),
  };
}

function canView(actor: ExpenseActor, expense: ExpenseRecord): boolean {
  if (expense.businessId !== actor.businessId) return false;
  return isExpenseManager(actor) || expense.submittedBy.uid === actor.uid;
}

const sortNewestFirst = (a: ExpenseRecord, b: ExpenseRecord) =>
  (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.expenseCode.localeCompare(a.expenseCode);

/** Owners see every expense; staff see their own. */
export async function listExpenses(actor: ExpenseActor): Promise<ExpenseRecord[]> {
  let query = adminDb.collection(EXPENSE_COLLECTION).where("businessId", "==", actor.businessId);
  if (!isExpenseManager(actor)) query = query.where("submittedByUid", "==", actor.uid);
  const snapshot = await query.limit(LIST_LIMIT).get();
  return snapshot.docs.map((doc) => mapExpenseDoc(doc.id, doc.data())).sort(sortNewestFirst);
}

export async function listBusinessExpenses(businessId: string): Promise<ExpenseRecord[]> {
  const snapshot = await adminDb
    .collection(EXPENSE_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(LIST_LIMIT)
    .get();
  return snapshot.docs.map((doc) => mapExpenseDoc(doc.id, doc.data())).sort(sortNewestFirst);
}

export async function getExpense(actor: ExpenseActor, id: string): Promise<ExpenseRecord | null> {
  if (!id || id.includes("/")) return null;
  const snap = await adminDb.collection(EXPENSE_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const expense = mapExpenseDoc(snap.id, snap.data() ?? {});
  return canView(actor, expense) ? expense : null;
}

async function nextExpenseCode(businessId: string): Promise<string> {
  const ref = adminDb.collection("document_counters").doc(`expenses-${businessId}`);
  const next = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const last = num(snap.data()?.last) ?? 0;
    const value = Math.max(0, Math.floor(last)) + 1;
    tx.set(ref, { last: value, businessId, updatedAt: Date.now() }, { merge: true });
    return value;
  });
  return `EXP-${String(next).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Jobs a receipt can be linked to
// ---------------------------------------------------------------------------

export type ExpenseJobOption = {
  id: string;
  label: string;
  date: string | null;
  /** Server-side only: helps Sophie match a receipt that names the customer. */
  customerName?: string | null;
};

/**
 * Recent and upcoming jobs (30 days back, 7 ahead). Staff get the jobs they
 * are assigned to; owners get every job.
 */
export async function listExpenseJobs(
  actor: ExpenseActor,
  todayIso: string,
): Promise<ExpenseJobOption[]> {
  const snapshot = await adminDb
    .collection(JOBS_COLLECTION)
    .where("businessId", "==", actor.businessId)
    .orderBy("createdAt", "desc")
    .limit(400)
    .get()
    .catch(() => null);
  if (!snapshot) return [];
  const from = addDaysIso(todayIso, -30);
  const to = addDaysIso(todayIso, 7);
  const options: ExpenseJobOption[] = [];
  for (const doc of snapshot.docs) {
    const job = mapBookingDoc(doc.id, doc.data() ?? {});
    if (job.status === "cancelled") continue;
    if (!isExpenseManager(actor) && job.assignedTo?.uid !== actor.uid) continue;
    const date = job.scheduledSlot?.date ?? null;
    if (!date || date < from || date > to) continue;
    options.push({
      id: job.id,
      label: jobLabel(job),
      date,
      customerName: job.customer?.fullName?.trim() || null,
    });
  }
  return options.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

function jobLabel(job: ReturnType<typeof mapBookingDoc>): string {
  const service = job.serviceName ?? job.customRequest?.title ?? "Job";
  const suburb = job.address?.suburb?.trim();
  return [job.bookingCode, service, suburb].filter(Boolean).join(" · ");
}

async function loadJobOption(businessId: string, jobId: string): Promise<ExpenseJobOption | null> {
  if (!jobId || jobId.includes("/")) return null;
  const snap = await adminDb.collection(JOBS_COLLECTION).doc(jobId).get();
  if (!snap.exists) return null;
  const job = mapBookingDoc(snap.id, snap.data() ?? {});
  if (job.businessId !== businessId) return null;
  return { id: job.id, label: jobLabel(job), date: job.scheduledSlot?.date ?? null };
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

function duplicateInfo(expense: ExpenseRecord, exact: boolean): ExpenseDuplicate {
  return {
    id: expense.id,
    expenseCode: expense.expenseCode,
    vendor: expense.vendor,
    date: expense.date,
    amountAud: expense.amountAud,
    status: expense.status,
    submittedByName: expense.submittedBy.name,
    exact,
  };
}

async function findDuplicate(
  businessId: string,
  field: "receiptSha256" | "fingerprint",
  value: string | null,
  excludeId?: string,
): Promise<ExpenseRecord | null> {
  if (!value) return null;
  const snapshot = await adminDb
    .collection(EXPENSE_COLLECTION)
    .where("businessId", "==", businessId)
    .where(field, "==", value)
    .limit(5)
    .get();
  for (const doc of snapshot.docs) {
    if (doc.id === excludeId) continue;
    const expense = mapExpenseDoc(doc.id, doc.data());
    if (expense.status !== "rejected") return expense;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ExpenseResult =
  | { ok: true; expense: ExpenseRecord }
  | { ok: false; status: number; error: string; duplicate?: ExpenseDuplicate };

const fail = (status: number, error: string, duplicate?: ExpenseDuplicate): ExpenseResult => ({
  ok: false,
  status,
  error,
  ...(duplicate ? { duplicate } : {}),
});

function duplicateMessage(duplicate: ExpenseDuplicate): string {
  return duplicate.exact
    ? `This receipt was already added as ${duplicate.expenseCode}. It wasn't added again.`
    : `This looks like a duplicate of ${duplicate.expenseCode} (same shop, date and amount). It wasn't added.`;
}

function actorRole(actor: ExpenseActor) {
  return actor.role === "staff" ? ("staff" as const) : actor.role === "admin" ? ("admin" as const) : ("owner" as const);
}

async function audit(
  actor: ExpenseActor,
  action: string,
  summary: string,
  expense: ExpenseRecord,
  source: "admin_panel" | "mobile_app",
  metadata: Record<string, unknown> = {},
) {
  await logAuditEvent({
    businessId: actor.businessId,
    category: "expense",
    action,
    actor: { uid: actor.uid, role: actorRole(actor), name: actor.name, email: actor.email },
    source,
    summary,
    targetId: expense.id,
    targetLabel: expense.expenseCode,
    metadata: { status: expense.status, amountAud: expense.amountAud, ...metadata },
  });
}

/** Fields derived from the editable ones, written alongside every change. */
function derivedFields(values: {
  vendor: string | null;
  date: string | null;
  amountAud: number | null;
  receipt: unknown;
}, limitAud: number | null) {
  return {
    fingerprint: expenseFingerprint(values),
    missing: missingExpenseFields(values),
    overLimit: isOverSpendingLimit(values.amountAud, limitAud),
    limitAud,
  };
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

async function storeReceipt(
  actor: ExpenseActor,
  bytes: Buffer,
  contentType: string,
  sha256: string,
) {
  const bucketName = getStorageBucketName();
  const bucket = adminStorage.bucket(bucketName);
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `expenses/${actor.businessId}/${actor.uid}/${Date.now()}-${randomUUID()}.${ext}`;
  const token = randomUUID();
  await bucket.file(path).save(bytes, {
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
  });
  return {
    url: `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
    path,
    contentType,
    sha256,
  };
}

async function deleteReceiptFile(path: string | null | undefined) {
  if (!path || !path.startsWith("expenses/")) return;
  try {
    await adminStorage.bucket(getStorageBucketName()).file(path).delete({ ignoreNotFound: true });
  } catch {
    console.error("[expenses] could not delete a receipt file");
  }
}

async function buildReceiptContext(
  actor: ExpenseActor,
  business: ExpenseBusinessContext,
  todayIso: string,
): Promise<{ context: ReceiptContext; jobs: ExpenseJobOption[] }> {
  const jobs = await listExpenseJobs({ ...actor, role: "staff" }, todayIso).catch(() => []);
  return {
    jobs,
    context: {
      todayIso,
      vehicles: business.settings.vehicles.map(({ id, name, rego }) => ({ id, name, rego })),
      jobs: jobs.map((job) => ({
        id: job.id,
        label: job.customerName ? `${job.label} · ${job.customerName}` : job.label,
        date: job.date,
      })),
      submitterVehicleId: business.settings.vehicles.find((vehicle) => vehicle.staffUid === actor.uid)?.id ?? null,
    },
  };
}

/**
 * A receipt photo arrives: Sophie reads it and a draft expense is created
 * (or, with [expenseId], the receipt is added to an existing expense).
 * Exact repeats of an image are always refused; a receipt matching another
 * expense's shop, date and amount is refused unless [allowDuplicate].
 */
export async function addExpenseReceipt(
  actor: ExpenseActor,
  business: ExpenseBusinessContext,
  input: {
    bytes: Buffer;
    expenseId?: string | null;
    jobId?: string | null;
    allowDuplicate?: boolean;
    source: "admin_panel" | "mobile_app";
  },
): Promise<ExpenseResult> {
  const contentType = imageType(input.bytes);
  if (!contentType || !RECEIPT_TYPES.has(contentType)) {
    return fail(400, "Use a JPEG, PNG or WebP photo of the receipt.");
  }
  if (input.bytes.length > MAX_RECEIPT_BYTES) return fail(413, "Receipt photos must be 5 MB or smaller.");

  let existing: ExpenseRecord | null = null;
  if (input.expenseId) {
    existing = await getExpense(actor, input.expenseId);
    if (!existing) return fail(404, "Expense not found.");
    const editable = existing.status === "draft" || existing.status === "incomplete" ||
      (existing.status === "pending" && isExpenseManager(actor));
    if (!editable) return fail(409, "This expense has been decided, so its receipt can't change.");
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const sameImage = await findDuplicate(actor.businessId, "receiptSha256", sha256, existing?.id);
  if (sameImage) {
    const duplicate = duplicateInfo(sameImage, true);
    return fail(409, duplicateMessage(duplicate), duplicate);
  }

  const todayIso = platformTodayIso(new Date(), business.timeZone);
  const { context, jobs } = await buildReceiptContext(actor, business, todayIso);
  let reading: ReceiptReading | null = null;
  let readingFailed = false;
  try {
    reading = await readReceipt({ config: receiptAnalysisConfig(), image: { bytes: input.bytes, contentType }, context });
  } catch {
    readingFailed = true;
  }

  // Values the person already typed win over what Sophie read.
  const vendor = existing?.vendor ?? reading?.vendor ?? null;
  const date = existing?.date ?? reading?.date ?? null;
  const amountAud = existing?.amountAud ?? reading?.amountAud ?? null;
  const gstAud = existing?.gstAud ?? reading?.gstAud ?? null;

  if (!input.allowDuplicate && !existing?.duplicateOfId) {
    const similar = await findDuplicate(
      actor.businessId,
      "fingerprint",
      expenseFingerprint({ vendor, date, amountAud }),
      existing?.id,
    );
    if (similar) {
      const duplicate = duplicateInfo(similar, false);
      return fail(409, duplicateMessage(duplicate), duplicate);
    }
  }

  const receipt = await storeReceipt(actor, input.bytes, contentType, sha256).catch((error) => {
    console.error("[expenses] receipt upload failed", error instanceof Error ? error.message : "unknown");
    return null;
  });
  if (!receipt) return fail(500, "Could not save the receipt photo. Try again.");

  const vehicleId = existing?.vehicleId ?? reading?.vehicleId ?? null;
  const requestedJob = input.jobId ? await loadJobOption(actor.businessId, input.jobId) : null;
  const jobId = existing?.jobId ?? requestedJob?.id ?? reading?.jobId ?? null;
  const job = jobId ? jobs.find((option) => option.id === jobId) ?? requestedJob : null;
  const checks = reading?.checks ?? [
    readingFailed || receiptAnalysisConfig()
      ? "Sophie couldn't read this receipt. Fill in the details from the photo."
      : "Receipt reading is turned off. Fill in the details from the photo.",
  ];
  const sophie = {
    analysed: reading !== null,
    confidence: reading?.confidence ?? null,
    checks,
    analysedAt: Date.now(),
  };
  const values = { vendor, date, amountAud, receipt };
  const limitAud = business.settings.spendingLimitAud;
  const now = Date.now();

  if (existing) {
    const ref = adminDb.collection(EXPENSE_COLLECTION).doc(existing.id);
    const derived = derivedFields(values, limitAud);
    // A submitted expense that was only waiting for its receipt goes back for review.
    const resubmit = existing.status === "incomplete" && !derived.missing.includes("receipt") &&
      !derived.missing.some((field) => field !== "receipt");
    const status: ExpenseStatus = resubmit ? "pending" : existing.status;
    await ref.update({
      vendor,
      date,
      amountAud,
      gstAud,
      category: existing.vendor || existing.amountAud ? existing.category : reading?.category ?? existing.category,
      reason: existing.reason ?? reading?.reason ?? null,
      vehicleId,
      vehicleLabel: business.settings.vehicles.find((vehicle) => vehicle.id === vehicleId)?.name ?? existing.vehicleLabel,
      jobId,
      jobLabel: job?.label ?? existing.jobLabel,
      receipt,
      receiptSha256: sha256,
      sophie,
      status,
      ...derived,
      ...(resubmit ? { receiptRequest: null, submittedAt: now } : {}),
      updatedAt: now,
    });
    await deleteReceiptFile(existing.receipt?.path);
    const updated = mapExpenseDoc(existing.id, (await ref.get()).data() ?? {});
    await audit(actor, "expense.receipt_added", `Receipt added to ${updated.expenseCode}`, updated, input.source, {
      sophieRead: reading !== null,
    });
    if (resubmit && updated.overLimit && !isExpenseManager(actor)) {
      await notifyOwnerExpenseNeedsApproval(business, updated);
    }
    return { ok: true, expense: updated };
  }

  const ref = adminDb.collection(EXPENSE_COLLECTION).doc();
  const expenseCode = await nextExpenseCode(actor.businessId);
  const record = {
    businessId: actor.businessId,
    expenseCode,
    status: "draft" as ExpenseStatus,
    vendor,
    date,
    amountAud,
    gstAud,
    category: reading?.category ?? "other",
    reason: reading?.reason ?? null,
    vehicleId,
    vehicleLabel: business.settings.vehicles.find((vehicle) => vehicle.id === vehicleId)?.name ?? null,
    jobId,
    jobLabel: job?.label ?? null,
    paidWith: (actor.role === "staff" ? "personal" : "business") as ExpensePaidWith,
    receipt,
    receiptSha256: sha256,
    submittedBy: { uid: actor.uid, name: actor.name, role: actor.role === "staff" ? "staff" : "owner" },
    submittedByUid: actor.uid,
    sophie,
    ...derivedFields(values, limitAud),
    duplicateOfId: null,
    decision: null,
    reimbursement: { status: "not_needed", by: null, at: null, note: null },
    receiptRequest: null,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  const expense = mapExpenseDoc(ref.id, record);
  await audit(actor, "expense.created_from_receipt", `Sophie prepared draft ${expenseCode} from a receipt`, expense, input.source, {
    sophieRead: reading !== null,
    confidence: reading?.confidence ?? null,
  });
  return { ok: true, expense };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export type ExpenseFieldsInput = {
  vendor?: unknown;
  date?: unknown;
  amountAud?: unknown;
  gstAud?: unknown;
  category?: unknown;
  reason?: unknown;
  vehicleId?: unknown;
  jobId?: unknown;
  paidWith?: unknown;
};

type ParsedFields = Partial<{
  vendor: string | null;
  date: string | null;
  amountAud: number | null;
  gstAud: number | null;
  category: ExpenseCategory;
  reason: string | null;
  vehicleId: string | null;
  jobId: string | null;
  paidWith: ExpensePaidWith;
}>;

function parseAmount(value: unknown): number | null | undefined {
  if (value === null || value === "") return null;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_EXPENSE_AUD) return undefined;
  return roundCents(amount);
}

function parseFields(
  input: ExpenseFieldsInput,
  todayIso: string,
): { ok: true; value: ParsedFields } | { ok: false; error: string } {
  const value: ParsedFields = {};
  if ("vendor" in input) {
    if (input.vendor != null && typeof input.vendor !== "string") return { ok: false, error: "Enter the shop or supplier." };
    value.vendor = str(input.vendor)?.slice(0, 80) ?? null;
  }
  if ("date" in input) {
    if (input.date === null || input.date === "") value.date = null;
    else if (!isIsoDate(input.date)) return { ok: false, error: "Enter a valid date." };
    else if (input.date > todayIso) return { ok: false, error: "The date can't be in the future." };
    else value.date = input.date;
  }
  if ("amountAud" in input) {
    const amount = parseAmount(input.amountAud);
    if (amount === undefined || amount === 0) return { ok: false, error: "Enter an amount between $0.01 and $100,000." };
    value.amountAud = amount;
  }
  if ("gstAud" in input) {
    const gst = parseAmount(input.gstAud);
    if (gst === undefined) return { ok: false, error: "Enter a valid GST amount." };
    value.gstAud = gst;
  }
  if ("category" in input) {
    if (!isExpenseCategory(input.category)) return { ok: false, error: "Choose a category." };
    value.category = input.category;
  }
  if ("reason" in input) {
    if (input.reason != null && typeof input.reason !== "string") return { ok: false, error: "Enter a reason." };
    value.reason = str(input.reason)?.slice(0, 300) ?? null;
  }
  if ("vehicleId" in input) value.vehicleId = str(input.vehicleId);
  if ("jobId" in input) value.jobId = str(input.jobId);
  if ("paidWith" in input) {
    if (input.paidWith !== "business" && input.paidWith !== "personal") return { ok: false, error: "Choose how it was paid." };
    value.paidWith = input.paidWith;
  }
  return { ok: true, value };
}

async function resolveLinks(
  business: ExpenseBusinessContext,
  fields: ParsedFields,
): Promise<{ ok: true; links: Record<string, string | null> } | { ok: false; error: string }> {
  const links: Record<string, string | null> = {};
  if ("vehicleId" in fields) {
    if (fields.vehicleId) {
      const vehicle = business.settings.vehicles.find((item) => item.id === fields.vehicleId);
      if (!vehicle) return { ok: false, error: "That vehicle isn't in your vehicle list." };
      links.vehicleLabel = vehicle.name;
    } else {
      links.vehicleLabel = null;
    }
  }
  if ("jobId" in fields) {
    if (fields.jobId) {
      const job = await loadJobOption(business.businessId, fields.jobId);
      if (!job) return { ok: false, error: "That job wasn't found." };
      links.jobLabel = job.label;
    } else {
      links.jobLabel = null;
    }
  }
  return { ok: true, links };
}

function checkGst(amountAud: number | null, gstAud: number | null): string | null {
  if (gstAud != null && amountAud != null && gstAud >= amountAud) return "GST must be less than the total.";
  return null;
}

/** An expense typed in without a receipt (the receipt can be added later). */
export async function createManualExpense(
  actor: ExpenseActor,
  business: ExpenseBusinessContext,
  input: ExpenseFieldsInput & { allowDuplicate?: boolean; source: "admin_panel" | "mobile_app" },
): Promise<ExpenseResult> {
  const todayIso = platformTodayIso(new Date(), business.timeZone);
  const parsed = parseFields(input, todayIso);
  if (!parsed.ok) return fail(400, parsed.error);
  const fields = parsed.value;
  const gstError = checkGst(fields.amountAud ?? null, fields.gstAud ?? null);
  if (gstError) return fail(400, gstError);
  const links = await resolveLinks(business, fields);
  if (!links.ok) return fail(400, links.error);

  const values = {
    vendor: fields.vendor ?? null,
    date: fields.date ?? null,
    amountAud: fields.amountAud ?? null,
    receipt: null,
  };
  if (!input.allowDuplicate) {
    const similar = await findDuplicate(actor.businessId, "fingerprint", expenseFingerprint(values));
    if (similar) {
      const duplicate = duplicateInfo(similar, false);
      return fail(409, duplicateMessage(duplicate), duplicate);
    }
  }

  const ref = adminDb.collection(EXPENSE_COLLECTION).doc();
  const now = Date.now();
  const record = {
    businessId: actor.businessId,
    expenseCode: await nextExpenseCode(actor.businessId),
    status: "draft" as ExpenseStatus,
    ...values,
    gstAud: fields.gstAud ?? null,
    category: fields.category ?? "other",
    reason: fields.reason ?? null,
    vehicleId: fields.vehicleId ?? null,
    vehicleLabel: links.links.vehicleLabel ?? null,
    jobId: fields.jobId ?? null,
    jobLabel: links.links.jobLabel ?? null,
    paidWith: fields.paidWith ?? (actor.role === "staff" ? "personal" : "business"),
    receiptSha256: null,
    submittedBy: { uid: actor.uid, name: actor.name, role: actor.role === "staff" ? "staff" : "owner" },
    submittedByUid: actor.uid,
    sophie: null,
    ...derivedFields(values, business.settings.spendingLimitAud),
    duplicateOfId: null,
    decision: null,
    reimbursement: { status: "not_needed", by: null, at: null, note: null },
    receiptRequest: null,
    submittedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  const expense = mapExpenseDoc(ref.id, record);
  await audit(actor, "expense.created", `Expense ${expense.expenseCode} added without a receipt`, expense, input.source);
  return { ok: true, expense };
}

export async function updateExpenseFields(
  actor: ExpenseActor,
  business: ExpenseBusinessContext,
  id: string,
  input: ExpenseFieldsInput,
  source: "admin_panel" | "mobile_app",
): Promise<ExpenseResult> {
  const expense = await getExpense(actor, id);
  if (!expense) return fail(404, "Expense not found.");
  const editable = isExpenseManager(actor)
    ? expense.status === "draft" || expense.status === "incomplete" || expense.status === "pending"
    : expense.submittedBy.uid === actor.uid && (expense.status === "draft" || expense.status === "incomplete");
  if (!editable) return fail(409, "This expense can't be changed now.");

  const parsed = parseFields(input, platformTodayIso(new Date(), business.timeZone));
  if (!parsed.ok) return fail(400, parsed.error);
  const fields = parsed.value;
  const next = {
    vendor: "vendor" in fields ? fields.vendor ?? null : expense.vendor,
    date: "date" in fields ? fields.date ?? null : expense.date,
    amountAud: "amountAud" in fields ? fields.amountAud ?? null : expense.amountAud,
    receipt: expense.receipt,
  };
  const gstError = checkGst(next.amountAud, "gstAud" in fields ? fields.gstAud ?? null : expense.gstAud);
  if (gstError) return fail(400, gstError);
  const links = await resolveLinks(business, fields);
  if (!links.ok) return fail(400, links.error);

  const ref = adminDb.collection(EXPENSE_COLLECTION).doc(expense.id);
  await ref.update({
    ...fields,
    ...links.links,
    ...derivedFields(next, business.settings.spendingLimitAud),
    updatedAt: Date.now(),
  });
  const updated = mapExpenseDoc(expense.id, (await ref.get()).data() ?? {});
  await audit(actor, "expense.updated", `Expense ${updated.expenseCode} details changed`, updated, source, {
    fields: Object.keys(fields),
  });
  return { ok: true, expense: updated };
}

// ---------------------------------------------------------------------------
// Submitting and decisions (people only)
// ---------------------------------------------------------------------------

export async function submitExpense(
  actor: ExpenseActor,
  business: ExpenseBusinessContext,
  id: string,
  options: { allowDuplicate?: boolean; source: "admin_panel" | "mobile_app" },
): Promise<ExpenseResult> {
  const expense = await getExpense(actor, id);
  if (!expense) return fail(404, "Expense not found.");
  if (expense.submittedBy.uid !== actor.uid && !isExpenseManager(actor)) {
    return fail(403, "Only the person who added this expense can submit it.");
  }
  if (expense.status !== "draft" && expense.status !== "incomplete") {
    return fail(409, "This expense has already been submitted.");
  }
  const missing = missingExpenseFields(expense);
  const missingDetails = missing.filter((field) => field !== "receipt");
  if (missingDetails.length) {
    const labels = missingDetails.map((field) => EXPENSE_MISSING_LABELS[field].toLowerCase());
    return fail(400, `Add the ${labels.join(", ")} before you submit.`);
  }

  let duplicateOfId = expense.duplicateOfId;
  if (!duplicateOfId) {
    const similar = await findDuplicate(actor.businessId, "fingerprint", expenseFingerprint(expense), expense.id);
    if (similar && !options.allowDuplicate) {
      const duplicate = duplicateInfo(similar, false);
      return fail(409, duplicateMessage(duplicate), duplicate);
    }
    if (similar) duplicateOfId = similar.id;
  }

  const status = statusAfterSubmit(missing);
  const limitAud = business.settings.spendingLimitAud;
  const overLimit = isOverSpendingLimit(expense.amountAud, limitAud);
  const now = Date.now();
  const ref = adminDb.collection(EXPENSE_COLLECTION).doc(expense.id);
  await ref.update({
    status,
    missing,
    overLimit,
    limitAud,
    duplicateOfId,
    submittedAt: now,
    updatedAt: now,
    receiptRequest:
      status === "incomplete"
        ? {
            requestedAt: expense.receiptRequest?.requestedAt ?? now,
            requestedBy: expense.receiptRequest?.requestedBy ?? null,
            note: expense.receiptRequest?.note ?? null,
            remindersSent: expense.receiptRequest?.remindersSent ?? 0,
            lastReminderAt: expense.receiptRequest?.lastReminderAt ?? now,
          }
        : null,
  });
  const updated = mapExpenseDoc(expense.id, (await ref.get()).data() ?? {});
  await audit(
    actor,
    "expense.submitted",
    status === "incomplete"
      ? `Expense ${updated.expenseCode} submitted without a receipt`
      : `Expense ${updated.expenseCode} submitted for review${overLimit ? " (over the spending limit)" : ""}`,
    updated,
    options.source,
    { overLimit, duplicateConfirmed: Boolean(duplicateOfId) },
  );
  if (status === "pending" && overLimit && !isExpenseManager(actor)) {
    await notifyOwnerExpenseNeedsApproval(business, updated);
  }
  return { ok: true, expense: updated };
}

export async function decideExpense(
  actor: ExpenseActor,
  id: string,
  decision: "approve" | "reject",
  note: string | null,
  source: "admin_panel" | "mobile_app",
): Promise<ExpenseResult> {
  if (!isExpenseManager(actor)) return fail(403, "Only the owner or an admin can approve or reject expenses.");
  const expense = await getExpense(actor, id);
  if (!expense) return fail(404, "Expense not found.");
  if (expense.status !== "pending" && expense.status !== "incomplete") {
    return fail(409, expense.status === "draft" ? "This expense hasn't been submitted yet." : "This expense has already been decided.");
  }
  if (decision === "approve" && missingExpenseFields(expense).some((field) => field !== "receipt")) {
    return fail(400, "Add the shop, date and amount before approving.");
  }
  if (decision === "reject" && !note?.trim()) return fail(400, "Add a short reason for rejecting it.");

  const now = Date.now();
  const status: ExpenseStatus = decision === "approve" ? "approved" : "rejected";
  const ref = adminDb.collection(EXPENSE_COLLECTION).doc(expense.id);
  await ref.update({
    status,
    decision: { by: { uid: actor.uid, name: actor.name }, at: now, note: note?.trim().slice(0, 500) || null },
    reimbursement: {
      status: decision === "approve" && expense.paidWith === "personal" ? "owed" : "not_needed",
      by: null,
      at: null,
      note: null,
    },
    receiptRequest: null,
    updatedAt: now,
  });
  const updated = mapExpenseDoc(expense.id, (await ref.get()).data() ?? {});
  await audit(actor, `expense.${status}`, `Expense ${updated.expenseCode} ${status}`, updated, source, {
    overLimit: updated.overLimit,
    withoutReceipt: !updated.receipt,
  });
  if (updated.submittedBy.uid !== actor.uid) await notifyStaffExpenseDecision(updated);
  return { ok: true, expense: updated };
}

export async function requestExpenseReceipt(
  actor: ExpenseActor,
  id: string,
  note: string | null,
  source: "admin_panel" | "mobile_app",
): Promise<ExpenseResult> {
  if (!isExpenseManager(actor)) return fail(403, "Only the owner or an admin can ask for a receipt.");
  const expense = await getExpense(actor, id);
  if (!expense) return fail(404, "Expense not found.");
  if (expense.status !== "pending" && expense.status !== "incomplete") {
    return fail(409, "You can ask for a receipt while an expense is waiting for review.");
  }
  const now = Date.now();
  const ref = adminDb.collection(EXPENSE_COLLECTION).doc(expense.id);
  await ref.update({
    status: "incomplete",
    receiptRequest: {
      requestedAt: now,
      requestedBy: { uid: actor.uid, name: actor.name },
      note: note?.trim().slice(0, 300) || null,
      remindersSent: 0,
      lastReminderAt: now,
    },
    updatedAt: now,
  });
  const updated = mapExpenseDoc(expense.id, (await ref.get()).data() ?? {});
  await audit(actor, "expense.receipt_requested", `Receipt or details requested for ${updated.expenseCode}`, updated, source);
  if (updated.submittedBy.uid !== actor.uid) await notifyStaffReceiptRequested(updated);
  return { ok: true, expense: updated };
}

/** Records that a person paid the staff member back. No money moves here. */
export async function markExpenseReimbursed(
  actor: ExpenseActor,
  id: string,
  note: string | null,
  source: "admin_panel" | "mobile_app",
): Promise<ExpenseResult> {
  if (!isExpenseManager(actor)) return fail(403, "Only the owner or an admin can record a reimbursement.");
  const expense = await getExpense(actor, id);
  if (!expense) return fail(404, "Expense not found.");
  if (expense.status !== "approved" || expense.reimbursement.status !== "owed") {
    return fail(409, "Only approved expenses paid with the team member's own money are reimbursed.");
  }
  const now = Date.now();
  const ref = adminDb.collection(EXPENSE_COLLECTION).doc(expense.id);
  await ref.update({
    reimbursement: {
      status: "reimbursed",
      by: { uid: actor.uid, name: actor.name },
      at: now,
      note: note?.trim().slice(0, 300) || null,
    },
    updatedAt: now,
  });
  const updated = mapExpenseDoc(expense.id, (await ref.get()).data() ?? {});
  await audit(actor, "expense.reimbursed", `Reimbursement recorded for ${updated.expenseCode}`, updated, source);
  if (updated.submittedBy.uid !== actor.uid) await notifyStaffExpenseReimbursed(updated);
  return { ok: true, expense: updated };
}

/** Drafts can be deleted; submitted expenses stay on the record. */
export async function deleteDraftExpense(
  actor: ExpenseActor,
  id: string,
  source: "admin_panel" | "mobile_app",
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const expense = await getExpense(actor, id);
  if (!expense) return { ok: false, status: 404, error: "Expense not found." };
  if (expense.status !== "draft") return { ok: false, status: 409, error: "Only drafts can be deleted." };
  if (expense.submittedBy.uid !== actor.uid && !isExpenseManager(actor)) {
    return { ok: false, status: 403, error: "You can only delete your own drafts." };
  }
  await adminDb.collection(EXPENSE_COLLECTION).doc(expense.id).delete();
  await deleteReceiptFile(expense.receipt?.path);
  await audit(actor, "expense.draft_deleted", `Draft ${expense.expenseCode} deleted`, expense, source);
  return { ok: true };
}
