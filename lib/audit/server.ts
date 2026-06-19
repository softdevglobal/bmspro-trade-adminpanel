import "server-only";

import { listCustomerNotificationAuditEntries } from "@/lib/audit/customer-notification-entries";
import { adminDb } from "@/lib/firebase/admin";
import {
  AUDIT_COLLECTION,
  actorRoleFromClaim,
  parseAuditCategory,
  parseAuditSource,
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

function resolveStoredCategory(
  raw: unknown,
  action: string,
): AuditCategory {
  const parsed = parseAuditCategory(raw);
  if (parsed) return parsed;
  if (action.startsWith("invoice.")) {
    return "invoice";
  }
  if (action === "inspection.convert_to_booking" || action.startsWith("booking.")) {
    return "booking";
  }
  return "inspection";
}

function mapEntry(id: string, data: DocumentData): AuditLogEntry {
  const role = (data.actorRole ?? "system") as AuditActorRole;
  const action = typeof data.action === "string" ? data.action : "";
  return {
    id,
    businessId: asString(data.businessId),
    businessName: asString(data.businessName),
    category: resolveStoredCategory(data.category, action),
    action,
    actorUid: asString(data.actorUid),
    actorRole: role,
    actorName: asString(data.actorName),
    actorEmail: asString(data.actorEmail),
    source: parseAuditSource(data.source) ?? "system",
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
  /** When set, only events where this uid acted or was the target. */
  participantUid?: string | null;
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
    const category = filters.category;
    entries = entries.filter(
      (entry) =>
        entry.category === category ||
        (category === "booking" &&
          (entry.action === "inspection.convert_to_booking" ||
            entry.action.startsWith("booking."))) ||
        (category === "invoice" &&
          (entry.action.startsWith("invoice.") ||
            (entry.metadata?.origin === "invoice" &&
              (entry.category === "booking" ||
                entry.action.startsWith("booking."))))),
    );
  }
  if (filters.source) {
    entries = entries.filter((entry) => entry.source === filters.source);
  }
  if (filters.participantUid) {
    const uid = filters.participantUid;
    entries = entries.filter(
      (entry) =>
        entry.actorUid === uid ||
        entry.targetId === uid ||
        (typeof entry.metadata?.customerId === "string" &&
          entry.metadata.customerId === uid),
    );
  }

  entries = await mergeCustomerNotificationAuditEntries(entries, filters);

  entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return entries.slice(0, limit);
}

async function mergeCustomerNotificationAuditEntries(
  entries: AuditLogEntry[],
  filters: {
    businessId?: string | null;
    category?: AuditCategory | null;
    source?: AuditSource | null;
    participantUid?: string | null;
    limit?: number;
  },
): Promise<AuditLogEntry[]> {
  if (
    filters.category &&
    filters.category !== "customer_notification"
  ) {
    return entries;
  }

  const fromCollection = await listCustomerNotificationAuditEntries({
    businessId: filters.businessId,
    participantUid: filters.participantUid,
  });

  const loggedNotificationIds = new Set(
    entries
      .filter(
        (entry) =>
          entry.category === "customer_notification" && entry.targetId,
      )
      .map((entry) => entry.targetId as string),
  );

  const merged = [...entries];
  for (const entry of fromCollection) {
    if (entry.targetId && loggedNotificationIds.has(entry.targetId)) {
      continue;
    }
    if (filters.source && entry.source !== filters.source) {
      continue;
    }
    merged.push(entry);
  }

  if (filters.category === "customer_notification") {
    return merged.filter((entry) => entry.category === "customer_notification");
  }

  return merged;
}

export { actorRoleFromClaim };
