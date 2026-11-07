import { readTrustedStorage } from "@/lib/security/storage-read";
import "server-only";

import { createHash } from "node:crypto";
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
  documentVersionId: string | null;
  nameAliases: string[];
  archived: boolean;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CatalogItemInput = {
  name: string;
  priceAud: number;
  catalogItemId?: string | null;
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
    documentVersionId:
      typeof data.documentVersionId === "string" && data.documentVersionId.trim()
        ? data.documentVersionId.trim()
        : null,
    nameAliases: Array.isArray(data.nameAliases)
      ? data.nameAliases.filter((value): value is string => typeof value === "string")
      : [],
    archived: data.archived === true,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function itemNameIndexRef(businessId: string, name: string) {
  const key = createHash("sha256")
    .update(`${businessId}\0${normalizeName(name)}`)
    .digest("hex");
  return adminDb.collection("item_name_index").doc(key);
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
  options: { includeArchived?: boolean } = {},
): Promise<CatalogItem[]> {
  const snap = await adminDb
    .collection(ITEM_COLLECTION)
    .where("businessId", "==", businessId)
    .get();

  const items = await Promise.all(
    snap.docs.map(async (doc) => {
      const item = mapItemDoc(doc.id, doc.data() ?? {});
      if (!item.documentUrl || item.documentVersionId) return item;
      return ensureCurrentDocumentVersion(businessId, doc.id);
    }),
  );

  return items
    .filter((item) => options.includeArchived || !item.archived)
    .filter((item) => item.name.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureCurrentDocumentVersion(
  businessId: string,
  itemId: string,
): Promise<CatalogItem> {
  const ref = adminDb.collection(ITEM_COLLECTION).doc(itemId);
  await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data() ?? {};
    const documentUrl = typeof data.documentUrl === "string" ? data.documentUrl : "";
    if (
      !snap.exists ||
      data.businessId !== businessId ||
      !documentUrl ||
      (typeof data.documentVersionId === "string" && data.documentVersionId)
    ) {
      return;
    }
    const versionRef = ref.collection("documentVersions").doc();
    transaction.create(versionRef, {
      documentUrl,
      documentName: typeof data.documentName === "string" ? data.documentName : null,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(ref, {
      documentVersionId: versionRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const updated = await ref.get();
  return mapItemDoc(updated.id, updated.data() ?? {});
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
  const nameIndexRef = itemNameIndexRef(businessId, nameLower);
  let savedId = "";

  await adminDb.runTransaction(async (transaction) => {
    const nameIndex = await transaction.get(nameIndexRef);
    let itemRef: FirebaseFirestore.DocumentReference | null = null;
    let existingData: Record<string, unknown> = {};

    if (nameIndex.exists) {
      const indexData = nameIndex.data() ?? {};
      const itemId = typeof indexData.itemId === "string" ? indexData.itemId : "";
      if (indexData.active === false || !itemId) {
        throw new CatalogItemNameConflictError("That item name is reserved by a previous catalog name.");
      }
      itemRef = adminDb.collection(ITEM_COLLECTION).doc(itemId);
      const existingSnap = await transaction.get(itemRef);
      existingData = existingSnap.data() ?? {};
      if (
        !existingSnap.exists ||
        existingData.businessId !== businessId ||
        existingData.nameLower !== nameLower ||
        existingData.archived === true
      ) {
        throw new CatalogItemNameConflictError("An item with that name already exists.");
      }
    } else {
      const matches = await transaction.get(
        adminDb
          .collection(ITEM_COLLECTION)
          .where("businessId", "==", businessId)
          .where("nameLower", "==", nameLower)
          .limit(2),
      );
      if (matches.size > 1) {
        throw new CatalogItemNameConflictError("More than one catalog item already uses that name. Resolve the duplicates first.");
      }
      if (!matches.empty) {
        itemRef = matches.docs[0].ref;
        existingData = matches.docs[0].data() ?? {};
      } else {
        itemRef = adminDb.collection(ITEM_COLLECTION).doc();
      }
    }

    if (existingData.archived === true) {
      throw new CatalogItemNameConflictError(
        "That item was archived and its name is reserved.",
      );
    }

    const ref = itemRef!;
    const now = FieldValue.serverTimestamp();
    const updates: Record<string, unknown> = {
      businessId,
      name: input.name,
      nameLower,
      priceAud: input.priceAud,
      updatedAt: now,
    };
    if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
    if (input.code !== undefined) updates.code = input.code;
    if (input.description !== undefined) updates.description = input.description;

    const priorUrl = typeof existingData.documentUrl === "string" ? existingData.documentUrl : null;
    const priorName = typeof existingData.documentName === "string" ? existingData.documentName : null;
    if (input.documentUrl !== undefined) {
      updates.documentUrl = input.documentUrl;
      const nextDocumentName = input.documentUrl
        ? input.documentName !== undefined
          ? input.documentName
          : priorName
        : null;
      updates.documentName = nextDocumentName;
      if (!input.documentUrl) {
        updates.documentVersionId = null;
      } else if (input.documentUrl !== priorUrl || nextDocumentName !== priorName) {
        const versionRef = ref.collection("documentVersions").doc();
        transaction.create(versionRef, {
          documentUrl: input.documentUrl,
          documentName: nextDocumentName,
          createdAt: now,
        });
        updates.documentVersionId = versionRef.id;
      }
    } else if (input.documentName !== undefined) {
      updates.documentName = input.documentName;
      if (priorUrl && input.documentName !== priorName) {
        const versionRef = ref.collection("documentVersions").doc();
        transaction.create(versionRef, {
          documentUrl: priorUrl,
          documentName: input.documentName,
          createdAt: now,
        });
        updates.documentVersionId = versionRef.id;
      }
    }
    if (!nameIndex.exists) {
      transaction.set(nameIndexRef, {
        businessId,
        nameLower,
        itemId: ref.id,
        active: true,
        updatedAt: now,
      });
    }
    if (!existingData.createdAt) {
      updates.createdBy = createdBy;
      updates.createdAt = now;
    }
    transaction.set(ref, updates, { merge: true });
    savedId = ref.id;
  });

  const saved = await adminDb.collection(ITEM_COLLECTION).doc(savedId).get();
  return mapItemDoc(saved.id, saved.data() ?? {});
}

export class CatalogItemNameConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogItemNameConflictError";
  }
}

/** Maps a quotation line item to a catalog entry (unit rate, optional code). */
export function catalogInputFromQuotationLineItem(item: {
  name: string;
  catalogItemId?: string | null;
  rateAud?: number | null;
  priceAud: number;
  code?: string | null;
  description?: string | null;
}): CatalogItemInput {
  return {
    catalogItemId: item.catalogItemId ?? null,
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
    // A selected catalog item is already authoritative. Re-saving it from a
    // quote snapshot could accidentally undo a later catalog rename or price.
    if (item.catalogItemId) continue;
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

  // Keep the stable item id and document versions so issued quotes/jobs keep
  // resolving their instructions. Archived items disappear from new pickers.
  await ref.set(
    {
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
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
  const newNameLower = normalizeName(input.name);
  try {
    await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = snap.data() ?? {};
      if (!snap.exists || current.businessId !== businessId || current.archived === true) {
        throw new Error("ITEM_NOT_FOUND");
      }

      const oldNameLower =
        typeof current.nameLower === "string"
          ? current.nameLower
          : normalizeName(typeof current.name === "string" ? current.name : "");
      const newIndexRef = itemNameIndexRef(businessId, newNameLower);
      const oldIndexRef = itemNameIndexRef(businessId, oldNameLower);
      const [newIndex, oldIndex, matches] = await Promise.all([
        transaction.get(newIndexRef),
        transaction.get(oldIndexRef),
        transaction.get(
          adminDb
            .collection(ITEM_COLLECTION)
            .where("businessId", "==", businessId)
            .where("nameLower", "==", newNameLower)
            .limit(3),
        ),
      ]);
      if (
        (newIndex.exists && newIndex.data()?.itemId !== id) ||
        matches.docs.some((doc) => doc.id !== id)
      ) {
        throw new CatalogItemNameConflictError("Another catalog item already uses that name.");
      }

      const now = FieldValue.serverTimestamp();
      const updates: Record<string, unknown> = {
        name: input.name,
        nameLower: newNameLower,
        priceAud: input.priceAud,
        updatedAt: now,
      };
      if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
      if (input.code !== undefined) updates.code = input.code;
      if (input.description !== undefined) updates.description = input.description;

      const priorUrl = typeof current.documentUrl === "string" ? current.documentUrl : null;
      const priorName = typeof current.documentName === "string" ? current.documentName : null;
      if (input.documentUrl !== undefined) {
        updates.documentUrl = input.documentUrl;
        const nextDocumentName = input.documentUrl
          ? input.documentName !== undefined
            ? input.documentName
            : priorName
          : null;
        updates.documentName = nextDocumentName;
        if (!input.documentUrl) {
          updates.documentVersionId = null;
        } else if (input.documentUrl !== priorUrl || nextDocumentName !== priorName) {
          const versionRef = ref.collection("documentVersions").doc();
          transaction.create(versionRef, {
            documentUrl: input.documentUrl,
            documentName: nextDocumentName,
            createdAt: now,
          });
          updates.documentVersionId = versionRef.id;
        }
      } else if (input.documentName !== undefined) {
        updates.documentName = input.documentName;
        if (priorUrl && input.documentName !== priorName) {
          const versionRef = ref.collection("documentVersions").doc();
          transaction.create(versionRef, {
            documentUrl: priorUrl,
            documentName: input.documentName,
            createdAt: now,
          });
          updates.documentVersionId = versionRef.id;
        }
      }

      const aliases = Array.isArray(current.nameAliases)
        ? current.nameAliases.filter((value): value is string => typeof value === "string")
        : [];
      if (oldNameLower && oldNameLower !== newNameLower && !aliases.includes(oldNameLower)) {
        aliases.push(oldNameLower);
      }
      updates.nameAliases = aliases.filter((alias) => alias !== newNameLower);

      if (oldNameLower && oldNameLower !== newNameLower) {
        if (oldIndex.exists && oldIndex.data()?.itemId !== id) {
          throw new CatalogItemNameConflictError("The previous item name is linked to another catalog item.");
        }
        transaction.set(oldIndexRef, {
          businessId,
          nameLower: oldNameLower,
          itemId: id,
          active: false,
          updatedAt: now,
        });
      }
      transaction.set(newIndexRef, {
        businessId,
        nameLower: newNameLower,
        itemId: id,
        active: true,
        updatedAt: now,
      });
      transaction.set(ref, updates, { merge: true });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ITEM_NOT_FOUND") {
      return { ok: false, status: 404, error: "Item not found." };
    }
    if (error instanceof CatalogItemNameConflictError) {
      return { ok: false, status: 409, error: error.message };
    }
    throw error;
  }

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
  documentVersionId: string | null;
  name: string;
  documentUrl: string;
  documentName: string | null;
};

/**
 * Resolves issued quote lines by stable catalog id and immutable document
 * version. Name/alias matching is retained only for older records without ids,
 * and ambiguous legacy names are deliberately skipped instead of guessed.
 */
export async function resolveItemDocumentsForLines(
  businessId: string,
  lines: Array<{
    name: string;
    catalogItemId?: string | null;
    catalogDocumentVersionId?: string | null;
  }>,
): Promise<{ documents: ItemDocumentRef[]; ambiguousLegacyNames: string[] }> {
  if (lines.length === 0) return { documents: [], ambiguousLegacyNames: [] };

  const catalog = await listCatalogItems(businessId, { includeArchived: true });
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const byName = new Map<string, Set<string>>();
  for (const item of catalog) {
    for (const candidate of [item.name, ...item.nameAliases]) {
      const key = normalizeName(candidate);
      if (!key) continue;
      const ids = byName.get(key) ?? new Set<string>();
      ids.add(item.id);
      byName.set(key, ids);
    }
  }

  const seen = new Set<string>();
  const ambiguousLegacyNames = new Set<string>();
  const documents: ItemDocumentRef[] = [];
  for (const line of lines) {
    let item: CatalogItem | undefined;
    const itemId = line.catalogItemId?.trim();
    if (itemId) {
      item = byId.get(itemId);
      if (!item) continue;
    } else {
      const matches = byName.get(normalizeName(line.name));
      if (matches && matches.size > 1) {
        ambiguousLegacyNames.add(line.name);
        continue;
      }
      if (!matches || matches.size !== 1) continue;
      item = byId.get([...matches][0]!);
    }
    if (!item) continue;

    const requestedVersion = line.catalogDocumentVersionId?.trim() || null;
    let documentUrl = item.documentUrl;
    let documentName = item.documentName;
    const versionId = requestedVersion ?? item.documentVersionId;
    if (requestedVersion) {
      const versionSnap = await adminDb
        .collection(ITEM_COLLECTION)
        .doc(item.id)
        .collection("documentVersions")
        .doc(requestedVersion)
        .get();
      if (!versionSnap.exists) continue;
      const version = versionSnap.data() ?? {};
      documentUrl = typeof version.documentUrl === "string" ? version.documentUrl : null;
      documentName = typeof version.documentName === "string" ? version.documentName : null;
    }
    if (!documentUrl) continue;
    const key = `${item.id}:${versionId ?? "current"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    documents.push({
      itemId: item.id,
      documentVersionId: versionId,
      name: item.name,
      documentUrl,
      documentName,
    });
  }
  return {
    documents,
    ambiguousLegacyNames: [...ambiguousLegacyNames],
  };
}

/** Legacy name-only resolver; it never guesses when the old name is ambiguous. */
export async function resolveItemDocumentsByName(
  businessId: string,
  names: string[],
): Promise<ItemDocumentRef[]> {
  const result = await resolveItemDocumentsForLines(
    businessId,
    names.map((name) => ({ name })),
  );
  return result.documents;
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
    pdfBytes = await readTrustedStorage(item.documentUrl, [`items/${businessId}/`], "pdf");
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
