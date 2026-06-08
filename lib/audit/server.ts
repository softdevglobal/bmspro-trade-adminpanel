import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import {
  AUDIT_COLLECTION,
  actorRoleFromClaim,
  type AuditActorRole,
  type AuditCategory,
  type AuditEventInput,
  type AuditLogEntry,
  type AuditSource,
} from "@/lib/audit/types";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";

/** Small in-process cache so we don't re-read the business name per event. */
const businessNameCache = new Map<string, string | null>();

async function resolveBusinessName(
  businessId: string | null,
): Promise<string | null> {
  if (!businessId) return null;
  if (businessNameCache.has(businessId)) {
    return businessNameCache.get(businessId) ?? null;
  }
  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    const name =
      typeof data.businessName === "string" && data.businessName.trim()
        ? data.businessName.trim()
        : null;
    businessNameCache.set(businessId, name);
    return name;
  } catch {
    return null;
  }
}

/**
 * Writes a single audit event. Best-effort: any failure is logged and
 * swallowed so the originating action is never affected.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const businessName = await resolveBusinessName(input.businessId);
    await adminDb.collection(AUDIT_COLLECTION).add({
      businessId: input.businessId ?? null,
      businessName,
      category: input.category,
      action: input.action,
      actorUid: input.actor.uid ?? null,
      actorRole: input.actor.role,
      actorName: input.actor.name ?? null,
      actorEmail: input.actor.email ?? null,
      source: input.source,
      summary: input.summary,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      metadata: input.metadata ?? {},
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[audit] failed to write event:", error);
  }
}

function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapEntry(id: string, data: DocumentData): AuditLogEntry {
  const role = (data.actorRole ?? "system") as AuditActorRole;
  return {
    id,
    businessId: asString(data.businessId),
    businessName: asString(data.businessName),
    category: (data.category ?? "inspection") as AuditCategory,
    action: typeof data.action === "string" ? data.action : "",
    actorUid: asString(data.actorUid),
    actorRole: role,
    actorName: asString(data.actorName),
    actorEmail: asString(data.actorEmail),
    source: (data.source ?? "system") as AuditSource,
    summary: typeof data.summary === "string" ? data.summary : "",
    targetId: asString(data.targetId),
    targetLabel: asString(data.targetLabel),
    metadata:
      data.metadata && typeof data.metadata === "object"
        ? (data.metadata as Record<string, unknown>)
        : {},
    createdAt: toMillis(data.createdAt),
  };
}

/**
 * Reads audit events for the super-admin dashboard.
 *
 * To avoid requiring composite Firestore indexes we use at most one `where`
 * clause (businessId) and sort newest-first in memory. Category/source filters
 * are applied in memory after the fetch.
 */
export async function listAuditLogs(filters: {
  businessId?: string | null;
  category?: AuditCategory | null;
  source?: AuditSource | null;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);

  let snapshot;
  if (filters.businessId) {
    snapshot = await adminDb
      .collection(AUDIT_COLLECTION)
      .where("businessId", "==", filters.businessId)
      .limit(500)
      .get();
  } else {
    snapshot = await adminDb
      .collection(AUDIT_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();
  }

  let entries = snapshot.docs.map((doc) => mapEntry(doc.id, doc.data() ?? {}));

  if (filters.category) {
    entries = entries.filter((entry) => entry.category === filters.category);
  }
  if (filters.source) {
    entries = entries.filter((entry) => entry.source === filters.source);
  }

  entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return entries.slice(0, limit);
}

export { actorRoleFromClaim };
