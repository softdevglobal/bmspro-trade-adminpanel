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
const MAX_TENANT_NUMBER = 999;
const SUFFIX_DIGITS = 4;
const BUSINESSES_COLLECTION = "businesses";
const COUNTERS_COLLECTION = "document_counters";

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
  return value >= 1 && value <= MAX_TENANT_NUMBER ? value : null;
}

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String(bytes[i]! % 10);
  }
  return out;
}

function randomTenantNumber(): number {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return (((bytes[0]! << 8) | bytes[1]!) % MAX_TENANT_NUMBER) + 1;
}

function counterDoc(id: string) {
  return adminDb.collection(COUNTERS_COLLECTION).doc(id);
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
  const claimSnap = await counterDoc(`tenant-${formatTenantNumber(n)}`).get();
  if (claimSnap.exists) return true;
  const businesses = await adminDb
    .collection(BUSINESSES_COLLECTION)
    .where("tenantNumber", "==", n)
    .limit(1)
    .get();
  return !businesses.empty;
}

/** Random unused 3-digit tenant code (`001`–`999`). */
export async function allocateTenantNumber(): Promise<number> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const n = randomTenantNumber();
    if (await tenantNumberInUse(n)) continue;
    if (await claimDoc(counterDoc(`tenant-${formatTenantNumber(n)}`))) return n;
  }
  throw new Error("Could not allocate a unique tenant number.");
}

/** Stored tenant code, allocating a random unique one if missing. */
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

async function allocateUniqueSuffix(kind: "inv" | "qt"): Promise<string> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const suffix = randomDigits(SUFFIX_DIGITS);
    if (await claimDoc(counterDoc(`${kind}-${suffix}`))) return suffix;
  }
  throw new Error(
    kind === "inv"
      ? "Could not allocate a unique invoice number."
      : "Could not allocate a unique quotation number.",
  );
}

async function allocateDocumentCode(
  businessId: string,
  kind: "inv" | "qt",
  prefix: string,
): Promise<string> {
  const tenantNumber = await resolveTenantNumber(businessId);
  const suffix = await allocateUniqueSuffix(kind);
  return `${prefix} ${formatTenantNumber(tenantNumber)} ${suffix}`;
}

export async function allocateQuotationCode(businessId: string): Promise<string> {
  return allocateDocumentCode(businessId, "qt", QUOTATION_CODE_PREFIX);
}

export async function allocateInvoiceCode(businessId: string): Promise<string> {
  return allocateDocumentCode(businessId, "inv", INVOICE_CODE_PREFIX);
}
