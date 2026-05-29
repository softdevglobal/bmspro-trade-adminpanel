import type { InspectionRequestStatus } from "@/lib/inspection/types";

export const NOTIFICATION_COLLECTION = "notifications";

export type NotificationAudience = "business" | "customer";

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
  | "request_assigned";

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
  cancelled: "text-rose-600",
  completed: "text-primary",
};
