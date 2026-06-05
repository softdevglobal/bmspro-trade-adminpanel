import type { InspectionRequestStatus } from "@/lib/inspection/types";

/** Business owners and customers each get their own collection. */
export const BUSINESS_NOTIFICATION_COLLECTION = "business_notifications";
export const CUSTOMER_NOTIFICATION_COLLECTION = "customer_notifications";

export type NotificationAudience = "business" | "customer";

export function notificationCollectionFor(
  audience: NotificationAudience,
): string {
  return audience === "business"
    ? BUSINESS_NOTIFICATION_COLLECTION
    : CUSTOMER_NOTIFICATION_COLLECTION;
}

/**
 * Discrete event that produced a notification. Used to pick an icon/tone on
 * the client and to keep the stored copy human readable.
 */
export type NotificationType =
  | "request_created"
  | "request_scheduled"
  | "request_proposed"
  | "request_cancelled"
  | "request_completed"
  | "request_assigned"
  | "visit_on_the_way"
  | "booking_on_the_way";

/** Client-facing notification (timestamps are epoch millis). */
export type NotificationRecord = {
  id: string;
  audience: NotificationAudience;
  businessId: string | null;
  customerId: string | null;
  customerEmail: string | null;
  requestId: string;
  bookingSlug: string | null;
  businessName: string | null;
  customerName: string | null;
  status: InspectionRequestStatus;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
};

/** Status used purely for icon/tone selection on notification cards. */
export const NOTIFICATION_STATUS_ICON: Record<
  InspectionRequestStatus,
  string
> = {
  pending: "hourglass_top",
  owner_proposed: "edit_calendar",
  scheduled: "event_available",
  awaiting_decision: "pending_actions",
  cancelled: "event_busy",
  completed: "check_circle",
};

export const NOTIFICATION_STATUS_TONE: Record<
  InspectionRequestStatus,
  string
> = {
  pending: "text-amber-600",
  owner_proposed: "text-violet-600",
  scheduled: "text-emerald-600",
  awaiting_decision: "text-orange-600",
  cancelled: "text-rose-600",
  completed: "text-primary",
};
