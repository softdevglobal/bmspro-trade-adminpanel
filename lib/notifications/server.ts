import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  NOTIFICATION_COLLECTION,
  type NotificationAudience,
  type NotificationRecord,
  type NotificationType,
} from "@/lib/notifications/types";
import {
  TIME_RANGE_SHORT_LABELS,
  formatSlotDate,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { FieldValue } from "firebase-admin/firestore";

const MAX_BATCH = 400;

type CreateNotificationInput = {
  audience: NotificationAudience;
  businessId: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  requestId: string;
  bookingSlug?: string | null;
  businessName?: string | null;
  status: InspectionRequestStatus;
  type: NotificationType;
  title: string;
  body: string;
};

function mapNotificationDoc(
  id: string,
  data: Record<string, unknown>,
): NotificationRecord {
  return {
    id,
    audience: data.audience === "customer" ? "customer" : "business",
    businessId: typeof data.businessId === "string" ? data.businessId : null,
    customerId: typeof data.customerId === "string" ? data.customerId : null,
    customerEmail:
      typeof data.customerEmail === "string" ? data.customerEmail : null,
    requestId: typeof data.requestId === "string" ? data.requestId : "",
    bookingSlug:
      typeof data.bookingSlug === "string" ? data.bookingSlug : null,
    businessName:
      typeof data.businessName === "string" ? data.businessName : null,
    status: (typeof data.status === "string"
      ? data.status
      : "pending") as InspectionRequestStatus,
    type: (typeof data.type === "string"
      ? data.type
      : "request_created") as NotificationType,
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    read: data.read === true,
    createdAt: toMillis(data.createdAt) ?? 0,
  };
}

async function createNotification(input: CreateNotificationInput): Promise<void> {
  const ref = adminDb.collection(NOTIFICATION_COLLECTION).doc();
  await ref.set({
    id: ref.id,
    audience: input.audience,
    businessId: input.businessId ?? null,
    customerId: input.customerId ?? null,
    customerEmail: input.customerEmail ?? null,
    requestId: input.requestId,
    bookingSlug: input.bookingSlug ?? null,
    businessName: input.businessName ?? null,
    status: input.status,
    type: input.type,
    title: input.title,
    body: input.body,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

function requestHeadline(request: InspectionRequestDetail): string {
  return (
    request.serviceName ??
    request.customRequest?.title ??
    (request.requestType === "custom_quote"
      ? "Custom quotation request"
      : "Inspection request")
  );
}

function slotLabel(slot: InspectionSlot): string {
  return `${formatSlotDate(slot.date)} · ${TIME_RANGE_SHORT_LABELS[slot.timeRange]}`;
}

/** Notify the business owner that a customer submitted a new request. */
export async function notifyBusinessOfNewRequest(
  request: InspectionRequestDetail,
): Promise<void> {
  const headline = requestHeadline(request);
  const who = request.customer.fullName?.trim() || "A customer";
  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      requestId: request.id,
      status: "pending",
      type: "request_created",
      title: "New inspection request",
      body: `${who} requested ${headline}.`,
    });
  } catch {
    /* notifications are best-effort */
  }
}

type CustomerNotifyContext = {
  bookingSlug?: string | null;
  businessName?: string | null;
};

/**
 * Notify the customer after a business owner action changes their request.
 * `nextStatus` is the request status after the action was applied.
 */
export async function notifyCustomerOfStatusChange(
  request: InspectionRequestDetail,
  nextStatus: InspectionRequestStatus,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const business = context.businessName ?? "The business";
  const headline = requestHeadline(request);

  let type: NotificationType = "request_scheduled";
  let title = "";
  let body = "";

  switch (nextStatus) {
    case "scheduled": {
      type = "request_scheduled";
      title = `${business} confirmed your visit`;
      body = request.scheduledSlot
        ? `Scheduled for ${slotLabel(request.scheduledSlot)}.`
        : `${headline} is now scheduled.`;
      break;
    }
    case "owner_proposed": {
      type = "request_proposed";
      const proposed = request.ownerProposedSlots.map(slotLabel).join(", ");
      title = `${business} proposed new times`;
      body = proposed
        ? `Suggested: ${proposed}.`
        : `${business} replied with new options for ${headline}.`;
      break;
    }
    case "cancelled": {
      type = "request_cancelled";
      title = `${business} cancelled your request`;
      body = request.ownerNote
        ? `Reason: ${request.ownerNote}`
        : `${headline} was cancelled.`;
      break;
    }
    case "completed": {
      type = "request_completed";
      title = `Visit completed with ${business}`;
      body = `${headline} is marked complete. Thanks for booking through BMS Pro Trade.`;
      break;
    }
    default:
      return;
  }

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      status: nextStatus,
      type,
      title,
      body,
    });
  } catch {
    /* notifications are best-effort */
  }
}

/** Notify the customer their inspection was assigned to a team member. */
export async function notifyCustomerOfAssignment(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  if (!request.assignedTo) return;
  const business = context.businessName ?? "The business";
  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      status: request.status,
      type: "request_assigned",
      title: `${business} assigned an inspector`,
      body: `${request.assignedTo.name} will visit for ${requestHeadline(request)}.`,
    });
  } catch {
    /* best-effort */
  }
}

function sortNewestFirst(records: NotificationRecord[]): NotificationRecord[] {
  return records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function listBusinessNotifications(
  businessId: string,
): Promise<NotificationRecord[]> {
  const snapshot = await adminDb
    .collection(NOTIFICATION_COLLECTION)
    .where("audience", "==", "business")
    .where("businessId", "==", businessId)
    .get();
  return sortNewestFirst(
    snapshot.docs.map((doc) => mapNotificationDoc(doc.id, doc.data() ?? {})),
  );
}

export async function listCustomerNotifications(
  customerId: string,
  customerEmail: string,
): Promise<NotificationRecord[]> {
  const [byId, byEmail] = await Promise.all([
    adminDb
      .collection(NOTIFICATION_COLLECTION)
      .where("audience", "==", "customer")
      .where("customerId", "==", customerId)
      .get(),
    customerEmail
      ? adminDb
          .collection(NOTIFICATION_COLLECTION)
          .where("audience", "==", "customer")
          .where("customerEmail", "==", customerEmail)
          .get()
      : Promise.resolve(null),
  ]);

  const docs = new Map<string, Record<string, unknown>>();
  for (const doc of byId.docs) docs.set(doc.id, doc.data() ?? {});
  if (byEmail) {
    for (const doc of byEmail.docs) {
      if (!docs.has(doc.id)) docs.set(doc.id, doc.data() ?? {});
    }
  }

  return sortNewestFirst(
    Array.from(docs.entries()).map(([id, data]) =>
      mapNotificationDoc(id, data),
    ),
  );
}

type OwnerGuard =
  | { audience: "business"; businessId: string }
  | { audience: "customer"; customerId: string; customerEmail: string };

function ownsNotification(
  data: Record<string, unknown>,
  guard: OwnerGuard,
): boolean {
  if (guard.audience === "business") {
    return data.audience === "business" && data.businessId === guard.businessId;
  }
  if (data.audience !== "customer") return false;
  return (
    data.customerId === guard.customerId ||
    (typeof data.customerEmail === "string" &&
      data.customerEmail === guard.customerEmail)
  );
}

/** Marks notifications as read for an audience. Returns false if not owned. */
export async function markNotificationRead(
  id: string,
  guard: OwnerGuard,
): Promise<boolean> {
  const ref = adminDb.collection(NOTIFICATION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (!ownsNotification(snap.data() ?? {}, guard)) return false;
  await ref.update({ read: true });
  return true;
}

export async function markAllNotificationsRead(
  guard: OwnerGuard,
): Promise<void> {
  const records =
    guard.audience === "business"
      ? await listBusinessNotifications(guard.businessId)
      : await listCustomerNotifications(guard.customerId, guard.customerEmail);

  const unread = records.filter((record) => !record.read);
  for (let i = 0; i < unread.length; i += MAX_BATCH) {
    const batch = adminDb.batch();
    for (const record of unread.slice(i, i + MAX_BATCH)) {
      batch.update(
        adminDb.collection(NOTIFICATION_COLLECTION).doc(record.id),
        { read: true },
      );
    }
    await batch.commit();
  }
}

export async function deleteNotification(
  id: string,
  guard: OwnerGuard,
): Promise<boolean> {
  const ref = adminDb.collection(NOTIFICATION_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (!ownsNotification(snap.data() ?? {}, guard)) return false;
  await ref.delete();
  return true;
}

export async function deleteAllNotifications(
  guard: OwnerGuard,
): Promise<void> {
  const records =
    guard.audience === "business"
      ? await listBusinessNotifications(guard.businessId)
      : await listCustomerNotifications(guard.customerId, guard.customerEmail);

  for (let i = 0; i < records.length; i += MAX_BATCH) {
    const batch = adminDb.batch();
    for (const record of records.slice(i, i + MAX_BATCH)) {
      batch.delete(adminDb.collection(NOTIFICATION_COLLECTION).doc(record.id));
    }
    await batch.commit();
  }
}
