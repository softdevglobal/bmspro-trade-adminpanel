import "server-only";

import type { AuditLogEntry } from "@/lib/audit/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapNotificationDoc } from "@/lib/notifications/map-notification-doc";
import {
  CUSTOMER_NOTIFICATION_COLLECTION,
  type NotificationType,
} from "@/lib/notifications/types";
import type { AuditActorRole, AuditSource } from "@/lib/audit/types";

const CUSTOMER_NOTIFICATION_AUDIT_LIMIT = 500;

/** Prefix so synthesized ids never collide with `audit_logs` document ids. */
export const CUSTOMER_NOTIFICATION_AUDIT_ID_PREFIX = "cn__";

export const CUSTOMER_NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> =
  {
    request_created: "Request received",
    request_scheduled: "Visit confirmed",
    request_proposed: "New times proposed",
    request_cancelled: "Request cancelled",
    request_completed: "Visit completed",
    request_assigned: "Team member assigned",
    visit_on_the_way: "On the way",
    booking_on_the_way: "Technician on the way",
    job_completed: "Job completed",
    invoice_sent: "Invoice sent",
    quotation_sent: "Quotation sent",
    quotation_accepted: "Quotation accepted",
    quotation_rejected: "Quotation rejected",
    leave_requested: "Leave request",
    leave_assignment_conflict: "Schedule conflict",
    staff_off_day: "Staff off day",
    schedule_reminder: "Schedule reminder",
    system_message: "System message",
  };

/** Types that are usually portal-only when written by the app today. */
const PORTAL_ONLY_TYPES = new Set<NotificationType>([
  "quotation_sent",
  "invoice_sent",
]);

function defaultCustomerNotificationAudit(input: {
  type: NotificationType;
  customerId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  businessName?: string | null;
}): {
  source: AuditSource;
  actor: {
    uid: string | null;
    role: AuditActorRole;
    name: string | null;
    email: string | null;
  };
} {
  if (input.type === "request_created") {
    return {
      source: "customer_portal",
      actor: {
        uid: input.customerId ?? null,
        role: "customer",
        name: input.customerName ?? null,
        email: input.customerEmail ?? null,
      },
    };
  }
  return {
    source: "admin_panel",
    actor: {
      uid: null,
      role: "system",
      name: input.businessName ?? null,
      email: null,
    },
  };
}

export type CustomerNotificationAuditInput = {
  notificationId: string;
  businessId: string | null;
  businessName?: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  requestId: string;
  type: NotificationType;
  title: string;
  status: string;
  createdAt?: number | null;
  portalOnly?: boolean;
  auditSource?: AuditSource;
  auditActor?: {
    uid?: string | null;
    role?: AuditActorRole;
    name?: string | null;
    email?: string | null;
  };
};

/** Builds an audit row from a `customer_notifications` document. */
export function customerNotificationToAuditEntry(
  input: CustomerNotificationAuditInput,
): AuditLogEntry {
  const defaults = defaultCustomerNotificationAudit(input);
  const source = input.auditSource ?? defaults.source;
  const actor = {
    uid: input.auditActor?.uid ?? defaults.actor.uid,
    role: input.auditActor?.role ?? defaults.actor.role,
    name: input.auditActor?.name ?? defaults.actor.name,
    email: input.auditActor?.email ?? defaults.actor.email,
  };
  const recipient =
    input.customerName?.trim() ||
    input.customerEmail?.trim() ||
    "customer";
  const typeLabel =
    CUSTOMER_NOTIFICATION_TYPE_LABELS[input.type] ?? input.type;
  const portalOnly =
    input.portalOnly === true || PORTAL_ONLY_TYPES.has(input.type);
  const delivery = portalOnly ? "in-portal only" : "email + portal";

  return {
    id: `${CUSTOMER_NOTIFICATION_AUDIT_ID_PREFIX}${input.notificationId}`,
    businessId: input.businessId,
    businessName: input.businessName ?? null,
    category: "customer_notification",
    action: `customer_notification.${input.type}`,
    actorUid: actor.uid,
    actorRole: actor.role,
    actorName: actor.name,
    actorEmail: actor.email,
    source,
    summary: `${typeLabel} notification to ${recipient}: "${input.title}" (${delivery})`,
    targetId: input.notificationId,
    targetLabel: recipient,
    metadata: {
      collection: "customer_notifications",
      notificationType: input.type,
      requestId: input.requestId,
      customerId: input.customerId ?? null,
      status: input.status,
      portalOnly,
      synthesizedFromCollection: true,
    },
    createdAt: input.createdAt ?? null,
  };
}

/**
 * Reads `customer_notifications` and maps them to audit rows so historical
 * data appears before the audit writer shipped.
 */
export async function listCustomerNotificationAuditEntries(filters: {
  businessId?: string | null;
  participantUid?: string | null;
}): Promise<AuditLogEntry[]> {
  let snapshot;
  if (filters.businessId) {
    snapshot = await adminDb
      .collection(CUSTOMER_NOTIFICATION_COLLECTION)
      .where("businessId", "==", filters.businessId)
      .limit(CUSTOMER_NOTIFICATION_AUDIT_LIMIT)
      .get();
  } else {
    snapshot = await adminDb
      .collection(CUSTOMER_NOTIFICATION_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(CUSTOMER_NOTIFICATION_AUDIT_LIMIT)
      .get();
  }

  let records = snapshot.docs.map((doc) =>
    mapNotificationDoc(doc.id, "customer", doc.data() ?? {}),
  );

  if (filters.participantUid) {
    const uid = filters.participantUid;
    records = records.filter((record) => record.customerId === uid);
  }

  return records
    .map((record) =>
      customerNotificationToAuditEntry({
        notificationId: record.id,
        businessId: record.businessId,
        businessName: record.businessName,
        customerId: record.customerId,
        customerEmail: record.customerEmail,
        customerName: record.customerName,
        requestId: record.requestId,
        type: record.type,
        title: record.title,
        status: record.status,
        createdAt: record.createdAt ?? null,
      }),
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
