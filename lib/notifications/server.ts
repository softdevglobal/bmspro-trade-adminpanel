import "server-only";

import { logCustomerNotificationCreated } from "@/lib/audit/action-logs";
import { customerOwnsNotificationRecord } from "@/lib/customer/ownership";
import { normalizeEmail } from "@/lib/customer/types";
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
import type { BookingDetail } from "@/lib/bookings/types";
import type { EmailDetailRow } from "@/lib/email/layout";
import { sendInspectionCustomerNotificationEmail } from "@/lib/email/templates/inspection-customer-notification";
import {
  resolveBusinessOwnerUid,
  sendBusinessAdminMobilePush,
  sendOwnerMobilePush,
  sendStaffMobilePush,
} from "@/lib/notifications/push";
import {
  formatInPlatformTimeZone,
  formatIsoDateInPlatformTimeZone,
} from "@/lib/platform/timezone";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import type { ScheduleReminderKind } from "@/lib/scheduling/types";
import { FieldValue } from "firebase-admin/firestore";
import {
  notifyBusinessNotificationsChanged,
  notifyCustomerNotificationsChanged,
} from "@/lib/notifications/realtime-hub";

const MAX_BATCH = 400;

type CreateNotificationInput = {
  audience: NotificationAudience;
  businessId: string | null;
  customerId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
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
  /** When true, only writes the in-portal notification (no email or SMS). */
  portalOnly?: boolean;
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

async function createNotification(
  input: CreateNotificationInput,
): Promise<string> {
  const collection = notificationCollectionFor(input.audience);
  const ref = adminDb.collection(collection).doc();
  const customerEmail = input.customerEmail
    ? normalizeEmail(input.customerEmail)
    : null;
  await ref.set(
    withoutEmpty({
      id: ref.id,
      businessId: input.businessId,
      customerId: input.customerId,
      customerEmail,
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

  if (
    input.audience === "customer" &&
    customerEmail &&
    !input.portalOnly
  ) {
    await sendInspectionCustomerNotificationEmail({
      customerEmail,
      customerPhone: input.customerPhone,
      customerName: input.customerName,
      bookingSlug: input.bookingSlug,
      businessName: input.businessName,
      logoUrl: input.logoUrl,
      businessId: input.businessId,
      inspectionRequestId: input.requestId,
      type: input.type,
      title: input.title,
      body: input.body,
      emailDetails: input.emailDetails,
      emailHighlight: input.emailHighlight,
      emailHighlightLabel: input.emailHighlightLabel,
    });
  }

  if (input.audience === "business" && input.businessId) {
    notifyBusinessNotificationsChanged(input.businessId);
  } else if (input.audience === "customer" && input.customerId) {
    notifyCustomerNotificationsChanged(input.customerId);
  }

  if (input.audience === "customer") {
    await logCustomerNotificationCreated({
      notificationId: ref.id,
      businessId: input.businessId,
      customerId: input.customerId,
      customerEmail: customerEmail,
      customerName: input.customerName,
      businessName: input.businessName,
      requestId: input.requestId,
      type: input.type,
      title: input.title,
      status: input.status,
      portalOnly: input.portalOnly,
    });
  }

  return ref.id;
}

function requestHeadline(request: InspectionRequestDetail): string {
  return (
    request.serviceName ??
    request.customRequest?.title ??
    (request.requestType === "custom_quote"
      ? "Custom quotation request"
      : "Request")
  );
}

function slotLabel(slot: InspectionSlot, timeZone?: string | null): string {
  return `${formatSlotDate(slot.date, timeZone)} · ${TIME_RANGE_SHORT_LABELS[slot.timeRange]}`;
}

/** Confirm to the customer that their request was received. */
export async function notifyCustomerOfNewRequest(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const business = context.businessName?.trim() || "the business";
  const timeZone = context.timezone;
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
      value: slotLabel(slot, timeZone),
    });
  });

  const preferredSummary =
    request.preferredSlots.length > 0
      ? request.preferredSlots.map((slot) => slotLabel(slot, timeZone)).join(" · ")
      : null;

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: email,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      requestId: request.id,
      status: "pending",
      type: "request_created",
      title: `We received your request — ${business}`,
      body: `Thanks for submitting your request with ${business}. Your request is pending review.\n\nWe'll email you when they confirm a visit time or suggest other options. You can also check status anytime from your account.`,
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
  const title = "New request";
  const body = `${who} requested ${headline}.`;
  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      requestId: request.id,
      status: "pending",
      type: "request_created",
      title,
      body,
    });

    await sendBusinessAdminMobilePush(request.businessId, {
      title,
      body,
      data: {
        type: "request_created",
        requestId: request.id,
        audience: "owner",
      },
    });
  } catch {
    /* notifications are best-effort */
  }
}

function formatLeaveDateRange(leave: {
  fromDate: string | null;
  toDate: string | null;
}): string {
  const from = leave.fromDate;
  const to = leave.toDate ?? leave.fromDate;
  if (!from) return "selected dates";
  if (!to || to === from) return from;
  return `${from} – ${to}`;
}

/** Notify business admins when a staff member submits a leave request. */
export async function notifyBusinessOfStaffLeaveRequest(
  leave: {
    id: string;
    businessId: string | null;
    requesterName: string;
    fromDate: string | null;
    toDate: string | null;
  },
  conflicts: { label: string; scheduledDate: string }[],
): Promise<void> {
  if (!leave.businessId) return;

  const dates = formatLeaveDateRange(leave);
  const hasConflicts = conflicts.length > 0;
  const title = hasConflicts ? "Leave conflicts with schedule" : "New leave request";
  const body = hasConflicts
    ? `${leave.requesterName} requested leave (${dates}) but is assigned to ${conflicts.length} job${conflicts.length === 1 ? "" : "s"} or visit${conflicts.length === 1 ? "" : "s"}. Reassign work before approving.`
    : `${leave.requesterName} requested leave for ${dates}. Review it in Team → Leave requests.`;

  try {
    await createNotification({
      audience: "business",
      businessId: leave.businessId,
      customerId: null,
      requestId: leave.id,
      status: "pending",
      type: hasConflicts ? "leave_assignment_conflict" : "leave_requested",
      title,
      body,
      portalOnly: true,
    });

    await sendBusinessAdminMobilePush(leave.businessId, {
      title,
      body,
      data: {
        type: hasConflicts ? "leave_assignment_conflict" : "leave_requested",
        requestId: leave.id,
        leaveId: leave.id,
        audience: "owner",
      },
    });
  } catch {
    /* notifications are best-effort */
  }
}

/** Warn admins when assigning staff who has leave on the scheduled day. */
export async function notifyBusinessOfStaffOnLeaveAssignment(
  businessId: string,
  staffName: string,
  scheduledDate: string,
  leaveStatus: "approved" | "pending",
  targetKind: "job" | "request",
  targetId: string,
): Promise<void> {
  const statusLabel =
    leaveStatus === "approved" ? "approved leave" : "a pending leave request";
  const title = "Staff member is on leave";
  const body = `${staffName} has ${statusLabel} on ${scheduledDate} and cannot be assigned to this ${targetKind === "job" ? "job" : "visit"}. Choose another team member or adjust the schedule.`;

  try {
    await createNotification({
      audience: "business",
      businessId,
      customerId: null,
      requestId: targetId,
      status: "pending",
      type: "leave_assignment_conflict",
      title,
      body,
      portalOnly: true,
    });

    await sendBusinessAdminMobilePush(businessId, {
      title,
      body,
      data: {
        type: "leave_assignment_conflict",
        requestId: targetId,
        audience: "owner",
      },
    });
  } catch {
    /* notifications are best-effort */
  }
}

/** Warn admins when assigning staff on one of their regular off days. */
export async function notifyBusinessOfStaffOffDayAssignment(
  businessId: string,
  staffName: string,
  scheduledDate: string,
  targetKind: "job" | "request",
  targetId: string,
): Promise<void> {
  const title = "Staff member is on an off day";
  const body = `${staffName} is not scheduled to work on ${scheduledDate} and cannot be assigned to this ${targetKind === "job" ? "job" : "visit"}. Choose another team member or update their availability.`;

  try {
    await createNotification({
      audience: "business",
      businessId,
      customerId: null,
      requestId: targetId,
      status: "pending",
      type: "staff_off_day",
      title,
      body,
      portalOnly: true,
    });

    await sendBusinessAdminMobilePush(businessId, {
      title,
      body,
      data: {
        type: "staff_off_day",
        requestId: targetId,
        audience: "owner",
      },
    });
  } catch {
    /* notifications are best-effort */
  }
}

type CustomerNotifyContext = {
  bookingSlug?: string | null;
  businessName?: string | null;
  logoUrl?: string | null;
  timezone?: string | null;
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
  const timeZone = context.timezone;
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
          ? `Your visit is set for ${slotLabel(request.scheduledSlot, timeZone)}, arriving ${visitWindow}.`
          : `Your visit is set for ${slotLabel(request.scheduledSlot, timeZone)}. We'll confirm the exact arrival time shortly.`
        : `${headline} is now scheduled.`;
      if (request.scheduledSlot) {
        emailDetails = [
          { label: "Service", value: headline },
          {
            label: "Date",
            value: formatSlotDate(request.scheduledSlot.date, timeZone),
          },
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
      const proposed = request.ownerProposedSlots
        .map((slot) => slotLabel(slot, timeZone))
        .join(", ");
      title = `${business} proposed new times`;
      body = proposed
        ? `${business} suggested new times for ${headline}. Open your request to accept one.`
        : `${business} replied with new options for ${headline}.`;
      if (request.ownerProposedSlots.length > 0) {
        emailDetails = [
          { label: "Service", value: headline },
          ...request.ownerProposedSlots.map((slot, index) => ({
            label: `Option ${index + 1}`,
            value: slotLabel(slot, timeZone),
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
    case "awaiting_decision": {
      type = "quotation_sent";
      title = `${business} sent your quotation`;
      body = `Review and accept or reject the quote for ${headline} in your requests.`;
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
      customerPhone: request.customer.phone || null,
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

/**
 * Notify the customer that their already-scheduled inspection visit was moved
 * to a new date/time (e.g. dragged to another slot on the calendar). Sends the
 * in-portal alert, email, and SMS.
 */
export async function notifyCustomerOfRequestRescheduled(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const headline = requestHeadline(request);
  const slot = request.scheduledSlot;
  if (!slot) return;

  const visitWindow = formatVisitWindow(
    request.scheduledStartTime,
    request.scheduledEndTime,
  );
  const title = `${business} rescheduled your visit`;
  const body = visitWindow
    ? `Your visit for ${headline} has been moved to ${slotLabel(slot, timeZone)}, arriving ${visitWindow}.`
    : `Your visit for ${headline} has been moved to ${slotLabel(slot, timeZone)}. We'll confirm the exact arrival time shortly.`;

  const emailDetails: EmailDetailRow[] = [
    { label: "Service", value: headline },
    { label: "New date", value: formatSlotDate(slot.date, timeZone) },
    { label: "Time of day", value: TIME_RANGE_LABELS[slot.timeRange] },
  ];

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "scheduled",
      type: "request_scheduled",
      title,
      body,
      emailDetails,
      emailHighlight: visitWindow ? visitWindow : "To be confirmed by the business",
      emailHighlightLabel: visitWindow ? "New arrival window" : "Arrival time",
    });
  } catch {
    /* notifications are best-effort */
  }
}

/** In-portal alert when a sent quotation needs accept/reject (email is sent separately). */
export async function notifyCustomerOfQuotationSent(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const business = context.businessName?.trim() || "The business";
  const headline = requestHeadline(request);
  const priceAud = request.quotation?.finalPriceAud;
  const priceLine =
    typeof priceAud === "number" && Number.isFinite(priceAud)
      ? ` Total: $${priceAud.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}.`
      : "";

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "awaiting_decision",
      type: "quotation_sent",
      title: `${business} sent your quotation`,
      body: `Accept or reject the quote for ${headline}.${priceLine}`,
      portalOnly: true,
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
  const timeZone = context.timezone;
  const visitWindow = formatVisitWindow(
    request.scheduledStartTime,
    request.scheduledEndTime,
  );
  const emailDetails: EmailDetailRow[] = [
    { label: "Service", value: requestHeadline(request) },
    { label: "Team member", value: request.assignedTo.name },
  ];
  if (request.scheduledSlot) {
    emailDetails.push({
      label: "Date",
      value: formatSlotDate(request.scheduledSlot.date, timeZone),
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
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: request.status,
      type: "request_assigned",
      title: `${request.assignedTo.name} will visit`,
      body: `${request.assignedTo.name} will visit for ${requestHeadline(request)}.`,
      emailDetails,
      emailHighlight: visitWindow ? visitWindow : null,
      emailHighlightLabel: visitWindow ? "Arrival window" : null,
    });
  } catch {
    /* best-effort */
  }
}

function bookingHeadline(booking: BookingDetail): string {
  return (
    booking.serviceName ??
    booking.customRequest?.title ??
    (booking.requestType === "custom_quote"
      ? "Custom job"
      : "Scheduled job")
  );
}

/** Notify the customer when the business confirms a job day after quotation acceptance. */
export async function notifyCustomerOfJobScheduled(
  booking: BookingDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const email = booking.customer.email?.trim();
  if (!email && !booking.customerId) return;

  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const headline = bookingHeadline(booking);
  const visitWindow = formatVisitWindow(
    booking.scheduledStartTime,
    booking.scheduledEndTime,
  );
  const title = `${business} confirmed your job`;
  const body = booking.scheduledSlot
    ? visitWindow
      ? `Your job (${headline}) is scheduled for ${slotLabel(booking.scheduledSlot, timeZone)}, arriving ${visitWindow}.`
      : `Your job (${headline}) is scheduled for ${slotLabel(booking.scheduledSlot, timeZone)}. We'll confirm the exact arrival time shortly.`
    : `${headline} is now scheduled as a job.`;

  const emailDetails: EmailDetailRow[] = [{ label: "Job", value: headline }];
  if (booking.bookingCode) {
    emailDetails.push({ label: "Reference", value: booking.bookingCode });
  }
  if (booking.scheduledSlot) {
    emailDetails.push({
      label: "Date",
      value: formatSlotDate(booking.scheduledSlot.date, timeZone),
    });
    emailDetails.push({
      label: "Time of day",
      value: TIME_RANGE_LABELS[booking.scheduledSlot.timeRange],
    });
  }

  try {
    await createNotification({
      audience: "customer",
      businessId: booking.businessId,
      customerId: booking.customerId,
      customerEmail: booking.customer.email || null,
      customerPhone: booking.customer.phone || null,
      customerName: booking.customer.fullName || null,
      requestId: booking.inspectionRequestId || booking.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "scheduled",
      type: "request_scheduled",
      title,
      body,
      emailDetails,
      emailHighlight: visitWindow
        ? visitWindow
        : booking.scheduledSlot
          ? "To be confirmed by the business"
          : null,
      emailHighlightLabel: visitWindow ? "Arrival window" : "Arrival time",
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Notify the customer that their scheduled job was moved to a new date/time
 * (e.g. dragged to another slot on the calendar). Sends the in-portal alert,
 * email, and SMS.
 */
export async function notifyCustomerOfJobRescheduled(
  booking: BookingDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const email = booking.customer.email?.trim();
  if (!email && !booking.customerId) return;

  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const headline = bookingHeadline(booking);
  const slot = booking.scheduledSlot;
  if (!slot) return;

  const visitWindow = formatVisitWindow(
    booking.scheduledStartTime,
    booking.scheduledEndTime,
  );
  const title = `${business} rescheduled your job`;
  const body = visitWindow
    ? `Your job (${headline}) has been moved to ${slotLabel(slot, timeZone)}, arriving ${visitWindow}.`
    : `Your job (${headline}) has been moved to ${slotLabel(slot, timeZone)}. We'll confirm the exact arrival time shortly.`;

  const emailDetails: EmailDetailRow[] = [{ label: "Job", value: headline }];
  if (booking.bookingCode) {
    emailDetails.push({ label: "Reference", value: booking.bookingCode });
  }
  emailDetails.push({
    label: "New date",
    value: formatSlotDate(slot.date, timeZone),
  });
  emailDetails.push({
    label: "Time of day",
    value: TIME_RANGE_LABELS[slot.timeRange],
  });

  try {
    await createNotification({
      audience: "customer",
      businessId: booking.businessId,
      customerId: booking.customerId,
      customerEmail: booking.customer.email || null,
      customerPhone: booking.customer.phone || null,
      customerName: booking.customer.fullName || null,
      requestId: booking.inspectionRequestId || booking.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "scheduled",
      type: "request_scheduled",
      title,
      body,
      emailDetails,
      emailHighlight: visitWindow ? visitWindow : "To be confirmed by the business",
      emailHighlightLabel: visitWindow ? "New arrival window" : "Arrival time",
    });
  } catch {
    /* best-effort */
  }
}

/** Notify the customer their technician has started the booked job and is on the way. */
export async function notifyCustomerOfBookingOnTheWay(
  booking: BookingDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  if (!booking.assignedTo) return;

  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const technician = booking.assignedTo.name;
  const headline = bookingHeadline(booking);
  const visitWindow = formatVisitWindow(
    booking.scheduledStartTime,
    booking.scheduledEndTime,
  );
  const address = formatAddress(booking.address);

  const emailDetails: EmailDetailRow[] = [
    { label: "Job", value: headline },
    { label: "Technician", value: technician },
  ];
  if (booking.bookingCode) {
    emailDetails.push({ label: "Job", value: booking.bookingCode });
  }
  if (address) {
    emailDetails.push({ label: "Address", value: address });
  }
  if (booking.scheduledSlot) {
    emailDetails.push({
      label: "Date",
      value: formatSlotDate(booking.scheduledSlot.date, timeZone),
    });
  }

  const body = visitWindow
    ? `${technician} from ${business} is on the way for your booked job (${headline}). Expected arrival: ${visitWindow}.`
    : `${technician} from ${business} is on the way for your booked job (${headline}).`;

  try {
    await createNotification({
      audience: "customer",
      businessId: booking.businessId,
      customerId: booking.customerId,
      customerEmail: booking.customer.email || null,
      customerPhone: booking.customer.phone || null,
      customerName: booking.customer.fullName || null,
      requestId: booking.inspectionRequestId || booking.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "scheduled",
      type: "booking_on_the_way",
      title: `${technician} is on the way for your job`,
      body,
      emailDetails,
      emailHighlight: visitWindow,
      emailHighlightLabel: visitWindow ? "Expected arrival" : null,
    });
  } catch {
    /* best-effort */
  }
}

function formatNotificationAud(value: number): string {
  return `Aus $${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Notify the customer when their booked job is marked complete (mobile/admin flow). */
export async function notifyCustomerOfJobCompleted(
  booking: BookingDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const email = booking.customer.email?.trim();
  if (!email && !booking.customerId) return;

  const business = context.businessName ?? "The business";
  const headline = bookingHeadline(booking);
  const technician = booking.assignedTo?.name;
  const emailDetails: EmailDetailRow[] = [
    { label: "Job", value: headline },
  ];
  if (booking.bookingCode) {
    emailDetails.push({ label: "Reference", value: booking.bookingCode });
  }
  if (technician) {
    emailDetails.push({ label: "Completed by", value: technician });
  }

  const body = technician
    ? `${technician} from ${business} has completed your job (${headline}). View your account for details and your invoice when it is ready.`
    : `${business} has completed your job (${headline}). View your account for details and your invoice when it is ready.`;

  try {
    await createNotification({
      audience: "customer",
      businessId: booking.businessId,
      customerId: booking.customerId,
      customerEmail: email || null,
      customerPhone: booking.customer.phone || null,
      customerName: booking.customer.fullName || null,
      requestId: booking.inspectionRequestId || booking.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "completed",
      type: "job_completed",
      title: `${business} completed your job`,
      body,
      emailDetails,
      emailHighlight: technician ?? null,
      emailHighlightLabel: technician ? "Completed by" : null,
    });
  } catch {
    /* best-effort */
  }
}

type InvoiceNotificationInput = {
  id: string;
  invoiceCode: string;
  inspectionRequestId: string;
  serviceTitle: string;
  customer: BookingDetail["customer"];
  finalPriceAud: number;
  balanceDueAud: number;
  dueDate?: string | null;
};

/** In-portal notification when an invoice is sent (email/SMS handled separately). */
export async function notifyCustomerOfInvoiceSent(
  businessId: string,
  invoice: InvoiceNotificationInput,
  context: CustomerNotifyContext & { customerId?: string | null } = {},
): Promise<void> {
  const requestId = invoice.inspectionRequestId?.trim();
  if (!requestId) return;

  let customerId = context.customerId ?? null;
  if (!customerId) {
    try {
      const snap = await adminDb
        .collection("requests")
        .doc(requestId)
        .get();
      const raw = snap.data()?.customerId;
      customerId = typeof raw === "string" ? raw : null;
    } catch {
      customerId = null;
    }
  }

  const email = invoice.customer.email?.trim();
  if (!email && !customerId) return;

  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const serviceTitle = invoice.serviceTitle.trim() || "your job";
  const emailDetails: EmailDetailRow[] = [
    { label: "Invoice", value: invoice.invoiceCode.trim() || "—" },
    { label: "Service", value: serviceTitle },
    {
      label: "Total",
      value: formatNotificationAud(invoice.finalPriceAud),
    },
    {
      label: "Amount due",
      value: formatNotificationAud(invoice.balanceDueAud),
    },
  ];
  if (invoice.dueDate?.trim()) {
    emailDetails.push({
      label: "Due date",
      value: formatSlotDate(invoice.dueDate.trim(), timeZone),
    });
  }

  try {
    await createNotification({
      audience: "customer",
      businessId,
      customerId,
      customerEmail: email || null,
      customerPhone: invoice.customer.phone || null,
      customerName: invoice.customer.fullName || null,
      requestId,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: "completed",
      type: "invoice_sent",
      title: `${business} sent your invoice`,
      body: `Your invoice for ${serviceTitle} is ready. We've emailed you the PDF — you can also view or download it from your account.`,
      emailDetails,
      emailHighlight: formatNotificationAud(invoice.balanceDueAud),
      emailHighlightLabel: "Amount due",
      portalOnly: true,
    });
  } catch {
    /* best-effort */
  }
}

/** Notify the customer their inspector has started the visit and is on the way. */
export async function notifyCustomerOfVisitOnTheWay(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  if (!request.assignedTo) return;

  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const inspector = request.assignedTo.name;
  const headline = requestHeadline(request);
  const visitWindow = formatVisitWindow(
    request.scheduledStartTime,
    request.scheduledEndTime,
  );
  const address = formatAddress(request.address);

  const emailDetails: EmailDetailRow[] = [
    { label: "Service", value: headline },
    { label: "Team member", value: inspector },
  ];
  if (address) {
    emailDetails.push({ label: "Address", value: address });
  }
  if (request.scheduledSlot) {
    emailDetails.push({
      label: "Date",
      value: formatSlotDate(request.scheduledSlot.date, timeZone),
    });
  }

  const body = visitWindow
    ? `${inspector} from ${business} is on the way for ${headline}. Expected arrival: ${visitWindow}.`
    : `${inspector} from ${business} is on the way for ${headline}.`;

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: request.status,
      type: "visit_on_the_way",
      title: `${inspector} is on the way`,
      body,
      emailDetails,
      emailHighlight: visitWindow,
      emailHighlightLabel: visitWindow ? "Expected arrival" : null,
    });
  } catch {
    /* best-effort */
  }
}

export type ScheduleReminderNotifyInput = {
  businessId: string;
  entityId: string;
  kind: ScheduleReminderKind;
  title: string;
  date: string;
  startTime: string;
  timeZone: string;
};

/** 30-minute heads-up for jobs, inspections, and personal calendar events. */
export async function notifyBusinessOfScheduleReminder(
  input: ScheduleReminderNotifyInput,
): Promise<void> {
  const kindLabel =
    input.kind === "job"
      ? "Job"
      : input.kind === "inspection_request"
        ? "Inspection"
        : "Event";
  const startAtMs = zonedDateTimeToUtcMs(
    input.date,
    input.startTime,
    input.timeZone,
  );
  const timeLabel = startAtMs
    ? formatInPlatformTimeZone(
        startAtMs,
        { hour: "numeric", minute: "2-digit", hour12: true },
        input.timeZone,
      )
    : input.startTime;
  const dateLabel = formatIsoDateInPlatformTimeZone(
    input.date,
    { weekday: "short", month: "short", day: "numeric" },
    input.timeZone,
  );
  const title = `${kindLabel} in 30 minutes`;
  const body = `${input.title} starts at ${timeLabel} on ${dateLabel}.`;

  try {
    await createNotification({
      audience: "business",
      businessId: input.businessId,
      customerId: null,
      requestId: input.entityId,
      status: "scheduled",
      type: "schedule_reminder",
      title,
      body,
      portalOnly: true,
    });

    await sendBusinessAdminMobilePush(input.businessId, {
      title,
      body,
      data: {
        type: "schedule_reminder",
        requestId: input.entityId,
        kind: input.kind,
        audience: "owner",
      },
    });
  } catch {
    /* best-effort */
  }
}

/** Notify the customer that the business proposed alternative job days. */
export async function notifyCustomerOfJobDatesProposed(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const business = context.businessName ?? "The business";
  const timeZone = context.timezone;
  const headline = requestHeadline(request);
  const proposed = request.jobProposedSlots
    .map((slot) => slotLabel(slot, timeZone))
    .join(", ");
  const title = `${business} proposed new job days`;
  const body = proposed
    ? `${business} suggested new days for your job (${headline}). Open your request to accept one.`
    : `${business} suggested new options for scheduling your job.`;

  try {
    await createNotification({
      audience: "customer",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      requestId: request.id,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      logoUrl: context.logoUrl ?? null,
      status: request.status,
      type: "request_proposed",
      title,
      body,
      emailDetails:
        request.jobProposedSlots.length > 0
          ? [
              { label: "Service", value: headline },
              ...request.jobProposedSlots.map((slot, index) => ({
                label: `Option ${index + 1}`,
                value: slotLabel(slot, timeZone),
              })),
            ]
          : undefined,
    });
  } catch {
    /* best-effort */
  }
}

/** Notify the business owner that the customer accepted a proposed job day. */
export async function notifyBusinessOfCustomerJobDateAcceptance(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const who = request.customer.fullName?.trim() || "The customer";
  const when = request.customerAcceptedJobSlot
    ? slotLabel(request.customerAcceptedJobSlot, context.timezone)
    : "";
  const headline = requestHeadline(request);
  const title = "Customer accepted a proposed job day";
  const body = when
    ? `${who} picked ${when} for ${headline}. You can now create the job.`
    : `${who} accepted one of your proposed job days for ${headline}.`;

  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      requestId: request.id,
      status: request.status,
      type: "request_scheduled",
      title,
      body,
    });
  } catch {
    /* best-effort */
  }
}

/** Notify the business owner that the customer accepted or rejected a quotation. */
export async function notifyBusinessOfQuotationDecision(
  request: InspectionRequestDetail,
  decision: "accepted" | "rejected",
  context: CustomerNotifyContext = {},
): Promise<void> {
  const who = request.customer.fullName?.trim() || "The customer";
  const headline = requestHeadline(request);
  const quoteCode = request.quotation?.quotationCode?.trim();
  const quoteLabel = quoteCode ? `quotation ${quoteCode}` : "the quotation";
  const title =
    decision === "accepted"
      ? "Quotation accepted"
      : "Quotation rejected";
  const timeZone = context.timezone;
  const jobDates =
    decision === "accepted" && request.jobPreferredSlots.length > 0
      ? request.jobPreferredSlots
          .map((slot) => slotLabel(slot, timeZone))
          .join(" · ")
      : "";
  const body =
    decision === "accepted"
      ? jobDates
        ? `${who} accepted ${quoteLabel} for ${headline}. Preferred job days: ${jobDates}. You can now schedule the job or issue an invoice.`
        : `${who} accepted ${quoteLabel} for ${headline}. You can now schedule the job or issue an invoice.`
      : `${who} rejected ${quoteLabel} for ${headline}.`;
  try {
    const notificationType =
      decision === "accepted" ? "quotation_accepted" : "quotation_rejected";
    const notificationId = await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      requestId: request.id,
      status: request.status,
      type: notificationType,
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
          type: notificationType,
          requestId: request.id,
          notificationId,
        },
      });
    }
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
  context: CustomerNotifyContext = {},
): Promise<void> {
  const who = request.customer.fullName?.trim() || "The customer";
  const when = request.scheduledSlot
    ? slotLabel(request.scheduledSlot, context.timezone)
    : "";
  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
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

/** Notify the business owner that the customer rejected proposed job days. */
export async function notifyBusinessOfCustomerJobProposalRejection(
  request: InspectionRequestDetail,
  context: CustomerNotifyContext = {},
): Promise<void> {
  const who = request.customer.fullName?.trim() || "The customer";
  const headline = requestHeadline(request);
  try {
    await createNotification({
      audience: "business",
      businessId: request.businessId,
      customerId: request.customerId,
      customerEmail: request.customer.email || null,
      customerPhone: request.customer.phone || null,
      customerName: request.customer.fullName || null,
      bookingSlug: context.bookingSlug ?? null,
      businessName: context.businessName ?? null,
      requestId: request.id,
      status: request.status,
      type: "request_created",
      title: "Customer rejected proposed job days",
      body: `${who} declined your proposed job days for ${headline}. Propose new days or schedule around their preferences.`,
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
  businessId?: string | null,
): Promise<NotificationRecord[]> {
  const normalizedEmail = customerEmail ? normalizeEmail(customerEmail) : "";
  const [byId, byEmail] = await Promise.all([
    adminDb
      .collection(CUSTOMER_NOTIFICATION_COLLECTION)
      .where("customerId", "==", customerId)
      .limit(NOTIFICATION_LIST_LIMIT)
      .get(),
    normalizedEmail
      ? adminDb
          .collection(CUSTOMER_NOTIFICATION_COLLECTION)
          .where("customerEmail", "==", normalizedEmail)
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

  const records = sortNewestFirst(
    Array.from(docs.entries()).map(([id, data]) =>
      mapNotificationRecord(id, "customer", data),
    ),
  );

  if (!businessId) return records;
  return records.filter((record) => record.businessId === businessId);
}

type OwnerGuard =
  | { audience: "business"; businessId: string }
  | {
      audience: "customer";
      customerId: string;
      customerEmail: string;
      businessId?: string | null;
    };

function ownsNotification(
  data: Record<string, unknown>,
  guard: OwnerGuard,
): boolean {
  if (guard.audience === "business") {
    return data.businessId === guard.businessId;
  }
  return customerOwnsNotificationRecord(data, {
    customerId: guard.customerId,
    customerEmail: guard.customerEmail,
    businessId: guard.businessId,
  });
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
  if (guard.audience === "business") {
    notifyBusinessNotificationsChanged(guard.businessId);
  } else {
    notifyCustomerNotificationsChanged(guard.customerId);
  }
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

  const normalizedEmail = normalizeEmail(guard.customerEmail);
  const businessId = guard.businessId?.trim() || null;
  const [byId, byEmail] = await Promise.all([
    adminDb
      .collection(collection)
      .where("customerId", "==", guard.customerId)
      .where("read", "==", false)
      .get(),
    normalizedEmail
      ? adminDb
          .collection(collection)
          .where("customerEmail", "==", normalizedEmail)
          .where("read", "==", false)
          .get()
      : Promise.resolve(null),
  ]);

  const seen = new Set<string>();
  for (const doc of byId.docs) {
    const data = doc.data() ?? {};
    if (
      businessId &&
      typeof data.businessId === "string" &&
      data.businessId !== businessId
    ) {
      continue;
    }
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      unreadIds.push(doc.id);
    }
  }
  if (byEmail) {
    for (const doc of byEmail.docs) {
      const data = doc.data() ?? {};
      if (
        businessId &&
        typeof data.businessId === "string" &&
        data.businessId !== businessId
      ) {
        continue;
      }
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

  if (guard.audience === "business") {
    notifyBusinessNotificationsChanged(guard.businessId);
  } else {
    notifyCustomerNotificationsChanged(guard.customerId);
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
  if (guard.audience === "business") {
    notifyBusinessNotificationsChanged(guard.businessId);
  } else {
    notifyCustomerNotificationsChanged(guard.customerId);
  }
  return true;
}

async function collectOwnedNotificationIds(
  guard: OwnerGuard,
): Promise<string[]> {
  const records =
    guard.audience === "business"
      ? await listBusinessNotifications(guard.businessId)
      : await listCustomerNotifications(
          guard.customerId,
          guard.customerEmail,
          guard.businessId,
        );
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

  if (guard.audience === "business") {
    notifyBusinessNotificationsChanged(guard.businessId);
  } else {
    notifyCustomerNotificationsChanged(guard.customerId);
  }
}
