import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import {
  buildBookingCode,
  buildInspectionRequestCode,
  formatTenantNumber,
  INVOICE_CODE_PREFIX,
  QUOTATION_CODE_PREFIX,
} from "@/lib/reference-codes";
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";

const MAX_ALLOCATION_ATTEMPTS = 24;
const MAX_SEQUENCE_SKIPS = 1000;
const SUFFIX_DIGITS = 4;
const BUSINESSES_COLLECTION = "businesses";
const COUNTERS_COLLECTION = "document_counters";
const TENANT_SEQUENCE_DOC = "tenant-sequence";
const DOCUMENT_CODE_TARGETS = {
  inv: { collection: "invoices", field: "invoiceCode" },
  qt: { collection: "quotations", field: "quotationCode" },
} as const;

async function codeExists(
  collection: string,
  field: string,
  code: string,
): Promise<boolean> {
  const snap = await adminDb
    .collection(collection)
    .where(field, "==", code)
    .limit(1)
    .get();
  return !snap.empty;
}

export async function allocateInspectionRequestCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const code = buildInspectionRequestCode();
    const taken = await codeExists(REQUESTS_COLLECTION, "requestCode", code);
    if (!taken) return code;
  }
  throw new Error("Could not allocate a unique request code.");
}

export async function allocateBookingCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const code = buildBookingCode();
    const taken = await codeExists(JOBS_COLLECTION, "bookingCode", code);
    if (!taken) return code;
  }
  throw new Error("Could not allocate a unique booking code.");
}

function parseTenantNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const value = Math.floor(n);
  return value >= 1 ? value : null;
}

function counterDoc(id: string) {
  return adminDb.collection(COUNTERS_COLLECTION).doc(id);
}

/** Claim docs keep the legacy 3-digit key so older claims still block reuse. */
function tenantClaimDoc(n: number) {
  return counterDoc(`tenant-${String(n).padStart(3, "0")}`);
}

async function nextSequenceValue(ref: DocumentReference): Promise<number> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.data()?.last;
    const last =
      typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
    const next = Math.max(0, last) + 1;
    tx.set(
      ref,
      { last: next, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return next;
  });
}

async function claimDoc(ref: DocumentReference): Promise<boolean> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.set(ref, { createdAt: FieldValue.serverTimestamp() });
    return true;
  });
}

async function tenantNumberInUse(n: number): Promise<boolean> {
  const claimSnap = await tenantClaimDoc(n).get();
  if (claimSnap.exists) return true;
  const businesses = await adminDb
    .collection(BUSINESSES_COLLECTION)
    .where("tenantNumber", "==", n)
    .limit(1)
    .get();
  return !businesses.empty;
}

/** Next tenant code in signup order (`01`, `02`, … `99`, `100`, …), skipping any already taken. */
export async function allocateTenantNumber(): Promise<number> {
  const sequenceRef = counterDoc(TENANT_SEQUENCE_DOC);
  for (let attempt = 0; attempt < MAX_SEQUENCE_SKIPS; attempt += 1) {
    const n = await nextSequenceValue(sequenceRef);
    if (await tenantNumberInUse(n)) continue;
    if (await claimDoc(tenantClaimDoc(n))) return n;
  }
  throw new Error("Could not allocate a unique tenant number.");
}

/** Stored tenant code, allocating the next sequential one if missing. */
export async function resolveTenantNumber(businessId: string): Promise<number> {
  const id = businessId.trim();
  if (!id) throw new Error("Missing business id for tenant number.");

  const businessRef = adminDb.collection(BUSINESSES_COLLECTION).doc(id);
  const existingSnap = await businessRef.get();
  if (!existingSnap.exists) {
    throw new Error("Business not found for tenant number.");
  }
  const existing = parseTenantNumber(existingSnap.data()?.tenantNumber);
  if (existing) return existing;

  const allocated = await allocateTenantNumber();
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(businessRef);
    const already = parseTenantNumber(snap.data()?.tenantNumber);
    if (already) return already;
    tx.set(
      businessRef,
      {
        tenantNumber: allocated,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return allocated;
  });
}

/** Per-tenant running number (`0001`, `0002`, …); skips codes already stored on older documents. */
async function allocateDocumentCode(
  businessId: string,
  kind: "inv" | "qt",
  prefix: string,
): Promise<string> {
  const tenantNumber = await resolveTenantNumber(businessId);
  const sequenceRef = counterDoc(`${kind}-tenant-${businessId.trim()}`);
  const target = DOCUMENT_CODE_TARGETS[kind];
  for (let attempt = 0; attempt < MAX_SEQUENCE_SKIPS; attempt += 1) {
    const n = await nextSequenceValue(sequenceRef);
    const suffix = String(n).padStart(SUFFIX_DIGITS, "0");
    const code = `${prefix} ${formatTenantNumber(tenantNumber)} ${suffix}`;
    if (await codeExists(target.collection, target.field, code)) continue;
    return code;
  }
  throw new Error(
    kind === "inv"
      ? "Could not allocate a unique invoice number."
      : "Could not allocate a unique quotation number.",
  );
}

export async function allocateQuotationCode(businessId: string): Promise<string> {
  return allocateDocumentCode(businessId, "qt", QUOTATION_CODE_PREFIX);
}

export async function allocateInvoiceCode(businessId: string): Promise<string> {
  return allocateDocumentCode(businessId, "inv", INVOICE_CODE_PREFIX);
}
