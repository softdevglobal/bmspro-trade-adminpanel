import type { CustomerBooking } from "@/app/api/customer/jobs/route";
import type { NotificationRecord } from "@/lib/notifications/types";

/** Requests that need customer action (date pick or quotation decision). */
export function customerPendingActionCount(
  bookings: CustomerBooking[],
  bookingSlug?: string | null,
): number {
  return customerPendingActionBookings(
    bookings,
    bookingSlug ?? "",
  ).length;
}

export function customerPendingActionBookings(
  bookings: CustomerBooking[],
  bookingSlug: string,
): CustomerBooking[] {
  return bookings.filter((booking) => {
    if (bookingSlug && booking.bookingSlug !== bookingSlug) return false;
    if (booking.status === "owner_proposed") return true;
    if (
      booking.status === "awaiting_decision" &&
      booking.quotation?.status === "sent" &&
      !booking.quotation.customerDecision
    ) {
      return true;
    }
    return false;
  });
}

/** Unread notifications plus pending actions not already covered by unread notes. */
export function customerAttentionCount(
  notifications: NotificationRecord[],
  bookings: CustomerBooking[],
  bookingSlug: string,
): number {
  const unread = notifications.filter((note) => !note.read);
  const coveredRequestIds = new Set(unread.map((note) => note.requestId));
  const pending = customerPendingActionBookings(bookings, bookingSlug).filter(
    (booking) => !coveredRequestIds.has(booking.id),
  );
  return unread.length + pending.length;
}
