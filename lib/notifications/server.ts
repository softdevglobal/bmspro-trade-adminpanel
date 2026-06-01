import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { mapNotificationDoc as mapNotificationRecord } from "@/lib/notifications/map-notification-doc";
import {
  BUSINESS_NOTIFICATION_COLLECTION,
  CUSTOMER_NOTIFICATION_COLLECTION,
  notificationCollectionFor,
  type NotificationAudience,
  type NotificationRecord,
  type NotificationType,
} from "@/lib/notifications/types";
import {
  TIME_RANGE_LABELS,
  TIME_RANGE_SHORT_LABELS,
  formatSlotDate,
  formatAddress,
  formatVisitWindow,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { buildBookingUrl } from "@/lib/onboarding/booking-slug";
import {
  renderEmail,
  type EmailDetailRow,
  type EmailTone,
} from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/zeptomail";
import {
  resolveBusinessOwnerUid,
  sendOwnerMobilePush,
} from "@/lib/notifications/push";
import { FieldValue } from "firebase-admin/firestore";

/** Eyebrow + tone shown in the customer email for each notification type. */
const EMAIL_PRESENTATION: Record<
  NotificationType,
  { eyebrow: string; tone: EmailTone }
> = {
  request_created: { eyebrow: "Inspection request", tone: "brand" },
  request_scheduled: { eyebrow: "Visit confirmed", tone: "success" },
  request_proposed: { eyebrow: "New times proposed", tone: "warning" },
  request_assigned: { eyebrow: "Inspector assigned", tone: "success" },
  request_cancelled: { eyebrow: "Request cancelled", tone: "danger" },
  request_completed: { eyebrow: "Visit completed", tone: "success" },
};

const MAX_BATCH = 400;

type CreateNotificationInput = {
  audience: NotificationAudience;
  businessId: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  requestId: string;
  bookingSlug?: string | null;
  businessName?: string | null;
  /** Optional business logo URL shown in customer emails. */
  logoUrl?: string | null;
  status: InspectionRequestStatus;
  type: NotificationType;
  title: string;
  body: string;
  /** Optional structured rows rendered in the customer email body. */
  emailDetails?: EmailDetailRow[];
  /** Optional highlighted callout (e.g. the confirmed arrival window). */
  emailHighlight?: string | null;
  /** Optional small label above the highlight callout. */
  emailHighlightLabel?: string | null;
};

/** Drops null/undefined/empty values so stored docs have no blank fields. */
function withoutEmpty(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === "") continue;
    result[key] = value;
  }
  return result;
}

async function createNotification(input: CreateNotificationInput): Promise<void> {
  const collection = notificationCollectionFor(input.audience);
  const ref = adminDb.collection(collection).doc();
  await ref.set(
    withoutEmpty({
      id: ref.id,
      businessId: input.businessId,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      requestId: input.requestId,
      bookingSlug: input.bookingSlug,
      businessName: input.businessName,
      status: input.status,
      type: input.type,
      title: input.title,
      body: input.body,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }),
  );

  if (input.audience === "customer" && input.customerEmail) {
    await sendCustomerNotificationEmail(input);
  }
}

/** Builds the customer-facing "view your request" link for emails. */
function customerRequestUrl(bookingSlug: string | null | undefined): string | null {
  if (!bookingSlug) return null;
  const base = buildBookingUrl(bookingSlug);
  if (!base) return null;
  return `${base}/account/requests`;
}

/** Best-effort email mirroring a customer notification. */
async function sendCustomerNotificationEmail(
  input: CreateNotificationInput,
): Promise<void> {
  if (!input.customerEmail) return;
  try {
    const ctaUrl = customerRequestUrl(input.bookingSlug);
    const presentation = EMAIL_PRESENTATION[input.type];
    const html = renderEmail({
      eyebrow: presentation?.eyebrow ?? "Inspection request",
      tone: presentation?.tone ?? "brand",
      title: input.title,
      greetingName: firstName(input.customerName),
      body: input.body,
      details: input.emailDetails,
      highlight: input.emailHighlight ?? null,
      highlightLabel: input.emailHighlightLabel ?? null,
      ctaUrl,
      ctaLabel: "View my request",
      footnote:
        "You're receiving this because you booked through BMS Pro Trade.",
      businessName: input.businessName,
      logoUrl: input.logoUrl ?? null,
    });
    await sendEmail({
      sender: "request",
      to: input.customerEmail,
      toName: input.customerName ?? null,
      subject: input.title,
      htmlBody: html,
    });
  } catch {
    /* email is best-effort */
  }
}

/** Returns the first word of a full name, or null. */
function firstName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
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

/** Confirm to the customer that their inspection request was received. */
export async function notifyCustomerOfNewRequest(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const business = context.businessName?.trim() || "the business";
  const headline = requestHeadline(request);
  const email = request.customer.email?.trim();
  if (!email) return;

  const emailDetails: EmailDetailRow[] = [{ label: "Service", value: headline }];
  const address = formatAddress(request.address).trim();
  if (address) {
    emailDetails.push({ label: "Address", value: address });
  }
  request.preferredSlots.forEach((slot, index) => {
    emailDetails.push({
      label:
        request.preferredSlots.length === 1
          ? "Preferred time"
          : `Preferred time ${index + 1}`,
      value: slotLabel(slot),
    });
  });

  const preferredSummary =
    request.preferredSlots.length > 0
      ? request.preferredSlots.map((slot) => slotLabel(slot)).join(" · ")
      : null;

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: email,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      requestId: request.id,
      status: "pending",
      type: "request_created",
      title: `We received your request — ${business}`,
      body: `Thanks for submitting your inspection request with ${business}. Your request is pending review.\n\nWe'll email you when they confirm a visit time or suggest other options. You can also check status anytime from your account.`,
      emailDetails,
      emailHighlight: preferredSummary,
      emailHighlightLabel: preferredSummary ? "Your preferred times" : null,
    });
  } catch {
    /* notifications are best-effort */
  }
}

/** Notify the business owner that a customer submitted a new request. */
export async function notifyBusinessOfNewRequest(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const headline = requestHeadline(request);
  const who = request.customer.fullName?.trim() || "A customer";
  const title = "New inspection request";
  const body = `${who} requested ${headline}.`;
  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      requestId: request.id,
      status: "pending",
      type: "request_created",
      title,
      body,
    });

    const ownerUid = await resolveBusinessOwnerUid(request.businessId);
    if (ownerUid) {
      await sendOwnerMobilePush({
        ownerUid,
        title,
        body,
        data: {
          type: "request_created",
          requestId: request.id,
        },
      });
    }
  } catch {
    /* notifications are best-effort */
  }
}

type CustomerNotifyContext = {
  bookingSlug?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
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
  let emailDetails: EmailDetailRow[] | undefined;
  let emailHighlight: string | null = null;
  let emailHighlightLabel: string | null = null;

  switch (nextStatus) {
    case "scheduled": {
      type = "request_scheduled";
      title = `${business} confirmed your visit`;
      const visitWindow = formatVisitWindow(
        request.scheduledStartTime,
        request.scheduledEndTime,
      );
      body = request.scheduledSlot
        ? visitWindow
          ? `Your visit is set for ${slotLabel(request.scheduledSlot)}, arriving ${visitWindow}.`
          : `Your visit is set for ${slotLabel(request.scheduledSlot)}. We'll confirm the exact arrival time shortly.`
        : `${headline} is now scheduled.`;
      if (request.scheduledSlot) {
        emailDetails = [
          { label: "Service", value: headline },
          { label: "Date", value: formatSlotDate(request.scheduledSlot.date) },
          {
            label: "Time of day",
            value: TIME_RANGE_LABELS[request.scheduledSlot.timeRange],
          },
        ];
        emailHighlight = visitWindow
          ? visitWindow
          : "To be confirmed by the business";
        emailHighlightLabel = visitWindow
          ? "Arrival window"
          : "Arrival time";
      }
      break;
    }
    case "owner_proposed": {
      type = "request_proposed";
      const proposed = request.ownerProposedSlots.map(slotLabel).join(", ");
      title = `${business} proposed new times`;
      body = proposed
        ? `${business} suggested new times for ${headline}. Open your request to accept one.`
        : `${business} replied with new options for ${headline}.`;
      if (request.ownerProposedSlots.length > 0) {
        emailDetails = [
          { label: "Service", value: headline },
          ...request.ownerProposedSlots.map((slot, index) => ({
            label: `Option ${index + 1}`,
            value: slotLabel(slot),
          })),
        ];
      }
      break;
    }
    case "cancelled": {
      type = "request_cancelled";
      title = `${business} cancelled your request`;
      body = request.ownerNote
        ? `Reason: ${request.ownerNote}`
        : `${headline} was cancelled.`;
      emailDetails = [{ label: "Service", value: headline }];
      break;
    }
    case "completed": {
      type = "request_completed";
      title = `Visit completed with ${business}`;
      body = `${headline} is marked complete. Thanks for booking through BMS Pro Trade.`;
      emailDetails = [{ label: "Service", value: headline }];
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
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: nextStatus,
      type,
      title,
      body,
      emailDetails,
      emailHighlight,
      emailHighlightLabel,
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
  const visitWindow = formatVisitWindow(
    request.scheduledStartTime,
    request.scheduledEndTime,
  );
  const emailDetails: EmailDetailRow[] = [
    { label: "Service", value: requestHeadline(request) },
    { label: "Inspector", value: request.assignedTo.name },
  ];
  if (request.scheduledSlot) {
    emailDetails.push({
      label: "Date",
      value: formatSlotDate(request.scheduledSlot.date),
    });
    emailDetails.push({
      label: "Time of day",
      value: TIME_RANGE_LABELS[request.scheduledSlot.timeRange],
    });
  }
  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: request.status,
      type: "request_assigned",
      title: `${business} assigned an inspector`,
      body: `${request.assignedTo.name} will visit for ${requestHeadline(request)}.`,
      emailDetails,
      emailHighlight: visitWindow ? visitWindow : null,
      emailHighlightLabel: visitWindow ? "Arrival window" : null,
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Notify the business owner that the customer accepted one of the proposed
 * times. The owner still needs to set a specific visit window.
 */
export async function notifyBusinessOfCustomerAcceptance(
  request: InspectionRequestDetail,
  context: { bookingSlug?: string | null; businessName?: string | null } = {},
): Promise<void> {
  const who = request.customer.fullName?.trim() || "The customer";
  const when = request.scheduledSlot ? slotLabel(request.scheduledSlot) : "";
  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      requestId: request.id,
      status: request.status,
      type: "request_scheduled",
      title: "Customer accepted a proposed time",
      body: when
        ? `${who} picked ${when}. Set the exact visit time window.`
        : `${who} accepted one of your proposed times. Set the exact visit time window.`,
    });
  } catch {
    /* best-effort */
  }
}

function sortNewestFirst(records: NotificationRecord[]): NotificationRecord[] {
  return records.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const NOTIFICATION_LIST_LIMIT = 50;

export async function listBusinessNotifications(
  businessId: string,
): Promise<NotificationRecord[]> {
  const snapshot = await adminDb
    .collection(BUSINESS_NOTIFICATION_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(NOTIFICATION_LIST_LIMIT)
    .get();
  return sortNewestFirst(
    snapshot.docs.map((doc) =>
      mapNotificationRecord(doc.id, "business", doc.data() ?? {}),
    ),
  );
}

export async function listCustomerNotifications(
  customerId: string,
  customerEmail: string,
): Promise<NotificationRecord[]> {
  const [byId, byEmail] = await Promise.all([
    adminDb
      .collection(CUSTOMER_NOTIFICATION_COLLECTION)
      .where("customerId", "==", customerId)
      .limit(NOTIFICATION_LIST_LIMIT)
      .get(),
    customerEmail
      ? adminDb
          .collection(CUSTOMER_NOTIFICATION_COLLECTION)
          .where("customerEmail", "==", customerEmail)
          .limit(NOTIFICATION_LIST_LIMIT)
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
      mapNotificationRecord(id, "customer", data),
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
    return data.businessId === guard.businessId;
  }
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
  const ref = adminDb.collection(notificationCollectionFor(guard.audience)).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (!ownsNotification(snap.data() ?? {}, guard)) return false;
  await ref.update({ read: true });
  return true;
}

async function collectUnreadNotificationIds(
  guard: OwnerGuard,
): Promise<string[]> {
  const collection = notificationCollectionFor(guard.audience);
  const unreadIds: string[] = [];

  if (guard.audience === "business") {
    const snap = await adminDb
      .collection(collection)
      .where("businessId", "==", guard.businessId)
      .where("read", "==", false)
      .get();
    for (const doc of snap.docs) unreadIds.push(doc.id);
    return unreadIds;
  }

  const [byId, byEmail] = await Promise.all([
    adminDb
      .collection(collection)
      .where("customerId", "==", guard.customerId)
      .where("read", "==", false)
      .get(),
    guard.customerEmail
      ? adminDb
          .collection(collection)
          .where("customerEmail", "==", guard.customerEmail)
          .where("read", "==", false)
          .get()
      : Promise.resolve(null),
  ]);

  const seen = new Set<string>();
  for (const doc of byId.docs) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      unreadIds.push(doc.id);
    }
  }
  if (byEmail) {
    for (const doc of byEmail.docs) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        unreadIds.push(doc.id);
      }
    }
  }
  return unreadIds;
}

export async function markAllNotificationsRead(
  guard: OwnerGuard,
): Promise<void> {
  const collection = notificationCollectionFor(guard.audience);
  const unreadIds = await collectUnreadNotificationIds(guard);
  for (let i = 0; i < unreadIds.length; i += MAX_BATCH) {
    const batch = adminDb.batch();
    for (const id of unreadIds.slice(i, i + MAX_BATCH)) {
      batch.update(adminDb.collection(collection).doc(id), { read: true });
    }
    await batch.commit();
  }
}

export async function deleteNotification(
  id: string,
  guard: OwnerGuard,
): Promise<boolean> {
  const ref = adminDb.collection(notificationCollectionFor(guard.audience)).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if (!ownsNotification(snap.data() ?? {}, guard)) return false;
  await ref.delete();
  return true;
}

async function collectOwnedNotificationIds(
  guard: OwnerGuard,
): Promise<string[]> {
  const records =
    guard.audience === "business"
      ? await listBusinessNotifications(guard.businessId)
      : await listCustomerNotifications(guard.customerId, guard.customerEmail);
  return records.map((record) => record.id);
}

export async function deleteAllNotifications(
  guard: OwnerGuard,
): Promise<void> {
  const collection = notificationCollectionFor(guard.audience);
  const ids = await collectOwnedNotificationIds(guard);
  for (let i = 0; i < ids.length; i += MAX_BATCH) {
    const batch = adminDb.batch();
    for (const id of ids.slice(i, i + MAX_BATCH)) {
      batch.delete(adminDb.collection(collection).doc(id));
    }
    await batch.commit();
  }
}
