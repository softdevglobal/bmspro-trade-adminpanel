import type { InspectionRequestStatus } from "@/lib/inspection/types";
import { toMillis } from "@/lib/onboarding/services/display";
import type {
  NotificationAudience,
  NotificationRecord,
  NotificationType,
} from "@/lib/notifications/types";

/** Maps a Firestore notification document to the client record shape. */
export function mapNotificationDoc(
  id: string,
  audience: NotificationAudience,
  data: Record<string, unknown>,
): NotificationRecord {
  return {
    id,
    audience,
    businessId: typeof data.businessId === "string" ? data.businessId : null,
    customerId: typeof data.customerId === "string" ? data.customerId : null,
    customerEmail:
      typeof data.customerEmail === "string" ? data.customerEmail : null,
    requestId: typeof data.requestId === "string" ? data.requestId : "",
    bookingSlug:
      typeof data.bookingSlug === "string" ? data.bookingSlug : null,
    businessName:
      typeof data.businessName === "string" ? data.businessName : null,
    customerName:
      typeof data.customerName === "string" ? data.customerName : null,
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

export function sortNotificationsNewestFirst(
  records: NotificationRecord[],
): NotificationRecord[] {
  return [...records].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
