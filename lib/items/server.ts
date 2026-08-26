import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

export const ITEM_COLLECTION = "items";

export type CatalogItem = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  priceAud: number;
  imageUrl: string | null;
  documentUrl: string | null;
  documentName: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CatalogItemInput = {
  name: string;
  priceAud: number;
  code?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  documentUrl?: string | null;
  documentName?: string | null;
};

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null && "toMillis" in value) {
    try {
      return (value as { toMillis: () => number }).toMillis();
    } catch {
      return null;
    }
  }
  return null;
}

function mapItemDoc(id: string, data: Record<string, unknown>): CatalogItem {
  return {
    id,
    name: typeof data.name === "string" ? data.name : "",
    code:
      typeof data.code === "string" && data.code.trim()
        ? data.code.trim()
        : null,
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : null,
    priceAud:
      typeof data.priceAud === "number" && Number.isFinite(data.priceAud)
        ? data.priceAud
        : 0,
    imageUrl:
      typeof data.imageUrl === "string" && data.imageUrl.trim()
        ? data.imageUrl.trim()
        : null,
    documentUrl:
      typeof data.documentUrl === "string" && data.documentUrl.trim()
        ? data.documentUrl.trim()
        : null,
    documentName:
      typeof data.documentName === "string" && data.documentName.trim()
        ? data.documentName.trim()
        : null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseImageUrl(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}

function parseCode(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > 50) return undefined;
  return trimmed || null;
}

function parseDescription(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > 500) return undefined;
  return trimmed || null;
}

function parseDocumentName(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length > 200) return undefined;
  return trimmed || null;
}

export function parseCatalogItemInput(raw: unknown): CatalogItemInput | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const priceAud =
    typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
      ? item.priceAud
      : typeof item.amountAud === "number" && Number.isFinite(item.amountAud)
        ? item.amountAud
        : null;
  if (!name || name.length > 200) return null;
  if (priceAud == null || priceAud < 0) return null;

  const parsed: CatalogItemInput = { name, priceAud };
  if ("code" in item) {
    const code = parseCode(item.code);
    if (code === undefined) return null;
    parsed.code = code;
  }
  if ("description" in item) {
    const description = parseDescription(item.description);
    if (description === undefined) return null;
    parsed.description = description;
  }
  if ("imageUrl" in item) {
    const imageUrl = parseImageUrl(item.imageUrl);
    if (imageUrl === undefined) return null;
    parsed.imageUrl = imageUrl;
  }
  if ("documentUrl" in item) {
    const documentUrl = parseImageUrl(item.documentUrl);
    if (documentUrl === undefined) return null;
    parsed.documentUrl = documentUrl;
  }
  if ("documentName" in item) {
    const documentName = parseDocumentName(item.documentName);
    if (documentName === undefined) return null;
    parsed.documentName = documentName;
  }
  if (parsed.documentUrl === null) {
    parsed.documentName = null;
  }
  return parsed;
}

export async function listCatalogItems(
  businessId: string,
): Promise<CatalogItem[]> {
  const snap = await adminDb
    .collection(ITEM_COLLECTION)
    .where("businessId", "==", businessId)
    .get();

  return snap.docs
    .map((doc) => mapItemDoc(doc.id, doc.data() ?? {}))
    .filter((item) => item.name.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Inserts or updates a catalog item, de-duplicating by normalized name within
 * the business. Returns the saved item.
 */
export async function upsertCatalogItem(
  businessId: string,
  createdBy: string,
  input: CatalogItemInput,
): Promise<CatalogItem> {
  const nameLower = normalizeName(input.name);

  const existing = await adminDb
    .collection(ITEM_COLLECTION)
    .where("businessId", "==", businessId)
    .where("nameLower", "==", nameLower)
    .limit(1)
    .get();

  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    const updates: Record<string, unknown> = {
      name: input.name,
      priceAud: input.priceAud,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (input.imageUrl !== undefined) {
      updates.imageUrl = input.imageUrl;
    }
    if (input.documentUrl !== undefined) {
      updates.documentUrl = input.documentUrl;
    }
    if (input.documentName !== undefined) {
      updates.documentName = input.documentName;
    }
    if (input.code !== undefined) {
      updates.code = input.code;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    await ref.set(updates, { merge: true });
    const saved = await ref.get();
    return mapItemDoc(ref.id, saved.data() ?? {});
  }

  const ref = adminDb.collection(ITEM_COLLECTION).doc();
  const payload: Record<string, unknown> = {
    businessId,
    name: input.name,
    nameLower,
    priceAud: input.priceAud,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.imageUrl) {
    payload.imageUrl = input.imageUrl;
  }
  if (input.documentUrl) {
    payload.documentUrl = input.documentUrl;
  }
  if (input.documentName) {
    payload.documentName = input.documentName;
  }
  if (input.code) {
    payload.code = input.code;
  }
  if (input.description) {
    payload.description = input.description;
  }
  await ref.set(payload);
  const saved = await ref.get();
  return mapItemDoc(ref.id, saved.data() ?? {});
}

/** Maps a quotation line item to a catalog entry (unit rate, optional code). */
export function catalogInputFromQuotationLineItem(item: {
  name: string;
  rateAud?: number | null;
  priceAud: number;
  code?: string | null;
  description?: string | null;
}): CatalogItemInput {
  return {
    name: item.name,
    priceAud:
      typeof item.rateAud === "number" && Number.isFinite(item.rateAud)
        ? item.rateAud
        : item.priceAud,
    code: item.code?.trim() || null,
    description: item.description?.trim() || null,
  };
}

/** Best-effort bulk upsert used when a quotation is created. */
export async function upsertCatalogItems(
  businessId: string,
  createdBy: string,
  items: CatalogItemInput[],
): Promise<void> {
  for (const item of items) {
    try {
      await upsertCatalogItem(businessId, createdBy, item);
    } catch {
      /* auto-save is best-effort */
    }
  }
}

export async function deleteCatalogItem(
  businessId: string,
  itemId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const id = itemId.trim();
  if (!id) return { ok: false, status: 400, error: "Missing item id." };

  const ref = adminDb.collection(ITEM_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Item not found." };
  }

  await ref.delete();
  return { ok: true };
}

export async function updateCatalogItem(
  businessId: string,
  itemId: string,
  input: CatalogItemInput,
): Promise<
  { ok: true; item: CatalogItem } | { ok: false; status: number; error: string }
> {
  const id = itemId.trim();
  if (!id) return { ok: false, status: 400, error: "Missing item id." };

  const ref = adminDb.collection(ITEM_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Item not found." };
  }

  const updates: Record<string, unknown> = {
    name: input.name,
    nameLower: normalizeName(input.name),
    priceAud: input.priceAud,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.imageUrl !== undefined) {
    updates.imageUrl = input.imageUrl;
  }
  if (input.documentUrl !== undefined) {
    updates.documentUrl = input.documentUrl;
  }
  if (input.documentName !== undefined) {
    updates.documentName = input.documentName;
  }
  if (input.code !== undefined) {
    updates.code = input.code;
  }
  if (input.description !== undefined) {
    updates.description = input.description;
  }

  await ref.set(updates, { merge: true });
  const saved = await ref.get();
  return { ok: true, item: mapItemDoc(ref.id, saved.data() ?? {}) };
}

/**
 * A catalog item's attached document, stripped of every pricing field.
 *
 * Staff are deliberately blocked from quotation pricing, so anything that
 * reaches an assigned tradesperson must carry the document and nothing else.
 */
export type ItemDocumentRef = {
  itemId: string;
  name: string;
  documentUrl: string;
  documentName: string | null;
};

/**
 * Resolves item names to the documents attached to the matching catalog items.
 *
 * Quotation line items store only a name and code — never a catalog id — so the
 * link back to the catalog is the same case- and whitespace-insensitive name
 * match `upsertCatalogItem` de-duplicates on.
 *
 * Returns documents in the order the names were given, with duplicate lines of
 * the same item collapsed, and items without a document dropped.
 */
export async function resolveItemDocumentsByName(
  businessId: string,
  names: string[],
): Promise<ItemDocumentRef[]> {
  const wanted = new Set(
    names.map(normalizeName).filter((name) => name.length > 0),
  );
  if (wanted.size === 0) return [];

  const catalog = await listCatalogItems(businessId);

  const byName = new Map<string, CatalogItem>();
  for (const item of catalog) {
    if (!item.documentUrl) continue;
    const key = normalizeName(item.name);
    // First match wins — the catalog is unique on normalized name per business.
    if (!byName.has(key)) byName.set(key, item);
  }

  const seen = new Set<string>();
  const documents: ItemDocumentRef[] = [];
  for (const raw of names) {
    const key = normalizeName(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const item = byName.get(key);
    if (!item?.documentUrl) continue;
    documents.push({
      itemId: item.id,
      name: item.name,
      documentUrl: item.documentUrl,
      documentName: item.documentName,
    });
  }
  return documents;
}

/**
 * Downloads the PDF attached to a catalog item.
 *
 * Fetched here rather than in the browser because Firebase Storage does not
 * send CORS headers for the app's origin — the same reason quotation and
 * invoice PDFs are proxied through the API. Keyed by item id so a caller can
 * never point the proxy at an arbitrary host.
 */
export async function getCatalogItemDocument(
  businessId: string,
  itemId: string,
): Promise<
  | { ok: true; pdfBytes: Buffer; fileName: string }
  | { ok: false; status: number; error: string }
> {
  const id = itemId.trim();
  if (!id) return { ok: false, status: 400, error: "Missing item id." };

  const snap = await adminDb.collection(ITEM_COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Item not found." };
  }

  const item = mapItemDoc(snap.id, snap.data() ?? {});
  if (!item.documentUrl) {
    return { ok: false, status: 404, error: "This item has no document." };
  }

  let pdfBytes: Buffer;
  try {
    const response = await fetch(item.documentUrl);
    if (!response.ok) throw new Error(`status ${response.status}`);
    pdfBytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error("[item] document fetch failed:", error);
    return { ok: false, status: 502, error: "Could not load this document." };
  }

  if (!pdfBytes.length) {
    return { ok: false, status: 502, error: "Could not load this document." };
  }

  const name = item.documentName?.trim() || `${item.name} document.pdf`;
  return {
    ok: true,
    pdfBytes,
    fileName: name.replace(/[^a-z0-9.\-]+/gi, "-"),
  };
}
