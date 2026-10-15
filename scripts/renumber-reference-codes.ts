/**
 * One-time renumbering of tenant numbers, invoice codes and quotation codes.
 *
 * - Tenants are numbered 01, 02, … by business `createdAt` (oldest first).
 * - Each tenant's invoices and quotations are numbered 0001, 0002, … by
 *   their own `createdAt`, separately for invoices and quotations.
 * - Every copy of an old code (requests, bookings, notifications, audit
 *   logs, …) is rewritten to the new code.
 * - Counters in `document_counters` are reset so new documents continue
 *   from the right number.
 *
 * DRY RUN BY DEFAULT — prints what it would change and writes nothing.
 * Stop anyone creating invoices/quotations/signups while applying.
 *
 *   npm run migrate:renumber-codes
 *   npm run migrate:renumber-codes -- --apply
 *
 * `--keep-document-codes` renumbers tenants only: existing invoice/quotation
 * codes stay as-is and each tenant's next ones start again from 0001.
 */

import type {
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { adminDb } from "../lib/firebase/admin";
import {
  displayQuotationCode,
  formatTenantNumber,
  INVOICE_CODE_PREFIX,
  QUOTATION_CODE_PREFIX,
} from "../lib/reference-codes";

const APPLY = process.argv.includes("--apply");
const KEEP_DOCUMENT_CODES = process.argv.includes("--keep-document-codes");

const SUFFIX_DIGITS = 4;
const COUNTERS_COLLECTION = "document_counters";

/** Collections that may hold copies of invoice/quotation codes. */
const REFERENCE_COLLECTIONS = [
  "invoices",
  "quotations",
  "requests",
  "inspection_requests",
  "jobs",
  "payment_links",
  "business_notifications",
  "customer_notifications",
  "audit_logs",
  "sms_logs",
  "conversations",
  "careplus_outbox",
  "careplus_captures",
];

type Doc = QueryDocumentSnapshot<DocumentData>;

function millis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.POSITIVE_INFINITY;
}

/** Oldest first; docs without `createdAt` go last. */
function byCreatedAt(a: Doc, b: Doc): number {
  const ma = millis(a.data().createdAt);
  const mb = millis(b.data().createdAt);
  if (ma !== mb) return ma < mb ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function stringField(data: DocumentData, field: string): string | null {
  const value = data[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function replaceDeep(
  value: unknown,
  pattern: RegExp,
  mapping: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    return value.replace(pattern, (match) => mapping.get(match) ?? match);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceDeep(item, pattern, mapping));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = replaceDeep(item, pattern, mapping);
    }
    return out;
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => sameValue(a[key], b[key]))
    );
  }
  return a === b;
}

function buildCode(prefix: string, tenantNumber: number, n: number): string {
  return `${prefix} ${formatTenantNumber(tenantNumber)} ${String(n).padStart(SUFFIX_DIGITS, "0")}`;
}

async function main() {
  console.log(
    APPLY
      ? "=== RENUMBER REFERENCE CODES (APPLYING CHANGES) ==="
      : "=== RENUMBER REFERENCE CODES (DRY RUN — nothing will be written) ===",
  );

  const [businessSnap, invoiceSnap, quotationSnap, requestSnap] = await Promise.all([
    adminDb.collection("businesses").get(),
    adminDb.collection("invoices").get(),
    adminDb.collection("quotations").get(),
    adminDb.collection("requests").get(),
  ]);
  const requestCodes = new Map<string, string | null>(
    requestSnap.docs.map((doc) => [doc.id, stringField(doc.data(), "requestCode")]),
  );

  const businesses = [...businessSnap.docs].sort(byCreatedAt);
  const tenantNumbers = new Map<string, number>();

  console.log(`\n--- Tenants (${businesses.length}) ---`);
  businesses.forEach((doc, index) => {
    const next = index + 1;
    tenantNumbers.set(doc.id, next);
    const data = doc.data();
    const old = typeof data.tenantNumber === "number" ? data.tenantNumber : null;
    const name = stringField(data, "businessName") ?? stringField(data, "name") ?? doc.id;
    console.log(
      `  ${formatTenantNumber(next).padEnd(4)} ← ${old == null ? "(none)" : formatTenantNumber(old)}  ${name}`,
    );
  });

  /** Old code → new code, shared across all collections. */
  const mapping = new Map<string, string>();
  /** Docs that need their own code field set (incl. docs that had none). */
  const codeAssignments: { collection: string; id: string; field: string; code: string }[] = [];
  const invoiceCounts = new Map<string, number>();
  const quotationCounts = new Map<string, number>();
  const orphans: string[] = [];

  function renumber(
    docs: Doc[],
    collection: string,
    field: string,
    prefix: string,
    counts: Map<string, number>,
    legacyCode: (doc: Doc) => string | null,
  ) {
    const grouped = new Map<string, Doc[]>();
    for (const doc of docs) {
      const businessId = stringField(doc.data(), "businessId");
      if (!businessId || !tenantNumbers.has(businessId)) {
        orphans.push(`${collection}/${doc.id}`);
        continue;
      }
      const list = grouped.get(businessId) ?? [];
      list.push(doc);
      grouped.set(businessId, list);
    }
    for (const [businessId, list] of grouped) {
      const tenantNumber = tenantNumbers.get(businessId)!;
      list.sort(byCreatedAt).forEach((doc, index) => {
        const code = buildCode(prefix, tenantNumber, index + 1);
        const old = stringField(doc.data(), field) ?? legacyCode(doc);
        if (old && old !== code) mapping.set(old, code);
        if (stringField(doc.data(), field) !== code) {
          codeAssignments.push({ collection, id: doc.id, field, code });
        }
      });
      counts.set(businessId, list.length);
    }
  }

  if (KEEP_DOCUMENT_CODES) {
    console.log("\nKeeping existing invoice/quotation codes; counters restart at 0001.");
  } else {
    renumber(invoiceSnap.docs, "invoices", "invoiceCode", INVOICE_CODE_PREFIX, invoiceCounts, () => null);
    renumber(
      quotationSnap.docs,
      "quotations",
      "quotationCode",
      QUOTATION_CODE_PREFIX,
      quotationCounts,
      (doc) => {
        const inspectionRequestId = stringField(doc.data(), "inspectionRequestId");
        const code = displayQuotationCode({
          id: doc.id,
          quotationCode: null,
          inspectionRequestId: inspectionRequestId ?? undefined,
          inspectionRequestCode: inspectionRequestId
            ? (requestCodes.get(inspectionRequestId) ?? null)
            : null,
        });
        return code === "—" ? null : code;
      },
    );
  }

  console.log(`\n--- Code changes (${mapping.size}) ---`);
  for (const [from, to] of mapping) console.log(`  ${from.padEnd(18)} → ${to}`);
  if (orphans.length) {
    console.log(`\n  ⚠ ${orphans.length} doc(s) skipped (missing/unknown businessId):`);
    for (const path of orphans) console.log(`      - ${path}`);
  }

  /** Field updates per document path. */
  const updates = new Map<string, Record<string, unknown>>();
  const patch = (path: string, field: string, value: unknown) => {
    const existing = updates.get(path) ?? {};
    existing[field] = value;
    updates.set(path, existing);
  };

  if (mapping.size > 0) {
    const pattern = new RegExp(
      `(?<![A-Za-z0-9])(?:${[...mapping.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|")})(?![A-Za-z0-9])`,
      "g",
    );
    console.log("\n--- References to rewrite ---");
    for (const collection of REFERENCE_COLLECTIONS) {
      const snap = await adminDb.collection(collection).get();
      let touched = 0;
      for (const doc of snap.docs) {
        let changed = false;
        for (const [field, value] of Object.entries(doc.data())) {
          const next = replaceDeep(value, pattern, mapping);
          if (sameValue(value, next)) continue;
          patch(`${collection}/${doc.id}`, field, next);
          changed = true;
        }
        if (changed) touched += 1;
      }
      if (touched) console.log(`  ${collection}: ${touched} doc(s)`);
    }
  }

  for (const item of codeAssignments) {
    patch(`${item.collection}/${item.id}`, item.field, item.code);
  }
  for (const doc of businesses) {
    const next = tenantNumbers.get(doc.id)!;
    if (doc.data().tenantNumber !== next) patch(`businesses/${doc.id}`, "tenantNumber", next);
  }

  const keptClaims = new Set(
    [...tenantNumbers.values()].map((n) => `tenant-${String(n).padStart(3, "0")}`),
  );
  const counterSnap = await adminDb.collection(COUNTERS_COLLECTION).get();
  const staleClaims = counterSnap.docs.filter(
    (doc) => /^(tenant-\d+|inv-\d+|qt-\d+)$/.test(doc.id) && !keptClaims.has(doc.id),
  );

  console.log(
    `\nSummary: ${updates.size} document(s) to update, ` +
      `${staleClaims.length} old claim doc(s) to replace, counters reset for ${businesses.length} tenant(s).`,
  );

  if (!APPLY) {
    console.log("\nDry run complete. Nothing was written.\nRe-run with --apply to commit.");
    return;
  }

  const writer = adminDb.bulkWriter();
  for (const [path, fields] of updates) {
    void writer.update(adminDb.doc(path), fields);
  }
  for (const doc of staleClaims) void writer.delete(doc.ref);

  const counters = adminDb.collection(COUNTERS_COLLECTION);
  const now = new Date();
  void writer.set(counters.doc("tenant-sequence"), { last: businesses.length, updatedAt: now });
  for (const doc of businesses) {
    const n = tenantNumbers.get(doc.id)!;
    void writer.set(counters.doc(`tenant-${String(n).padStart(3, "0")}`), { createdAt: now });
    void writer.set(counters.doc(`inv-tenant-${doc.id}`), {
      last: invoiceCounts.get(doc.id) ?? 0,
      updatedAt: now,
    });
    void writer.set(counters.doc(`qt-tenant-${doc.id}`), {
      last: quotationCounts.get(doc.id) ?? 0,
      updatedAt: now,
    });
  }
  await writer.close();
  console.log(`\n✓ Applied. Updated ${updates.size} document(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Renumber failed:", error);
    process.exit(1);
  });
