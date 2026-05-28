import type { CustomerBooking } from "@/app/api/customer/bookings/route";
import {
  STATUS_LABELS,
  TIME_RANGE_SHORT_LABELS,
  formatSlotDate,
} from "@/lib/inspection/types";

export type CustomerNotification = {
  id: string;
  bookingId: string;
  bookingSlug: string | null;
  businessName: string | null;
  status: CustomerBooking["status"];
  title: string;
  body: string;
  timestamp: number;
};

const STORAGE_KEY = "bmspt:customer:notifications:lastSeen";

function describe(booking: CustomerBooking): {
  title: string;
  body: string;
} {
  const business = booking.businessName ?? "Business";
  const headline =
    booking.serviceName ??
    booking.customRequest?.title ??
    "Inspection request";

  switch (booking.status) {
    case "pending":
      return {
        title: `Request sent to ${business}`,
        body: `Awaiting confirmation for ${headline}.`,
      };
    case "owner_proposed": {
      const proposed = booking.ownerProposedSlots
        .map(
          (slot) =>
            `${formatSlotDate(slot.date)} ${TIME_RANGE_SHORT_LABELS[slot.timeRange]}`,
        )
        .join(", ");
      return {
        title: `${business} proposed alternative times`,
        body: proposed
          ? `Suggested: ${proposed}.`
          : `${business} replied with new options.`,
      };
    }
    case "scheduled": {
      const slot = booking.scheduledSlot;
      const when = slot
        ? `${formatSlotDate(slot.date)} · ${TIME_RANGE_SHORT_LABELS[slot.timeRange]}`
        : "Scheduled";
      return {
        title: `${business} scheduled your visit`,
        body: when,
      };
    }
    case "completed":
      return {
        title: `Visit completed with ${business}`,
        body: `${headline} finished. Thanks for booking through BMS Pro Trade.`,
      };
    case "cancelled":
      return {
        title: `Visit cancelled by ${business}`,
        body: booking.ownerNote ? `Reason: ${booking.ownerNote}` : `${headline} was cancelled.`,
      };
    default:
      return {
        title: STATUS_LABELS[booking.status],
        body: headline,
      };
  }
}

export function buildCustomerNotifications(
  bookings: CustomerBooking[],
): CustomerNotification[] {
  return bookings
    .map((booking) => {
      const { title, body } = describe(booking);
      return {
        id: `${booking.id}:${booking.status}`,
        bookingId: booking.id,
        bookingSlug: booking.bookingSlug,
        businessName: booking.businessName,
        status: booking.status,
        title,
        body,
        timestamp: booking.updatedAt ?? booking.createdAt ?? 0,
      } satisfies CustomerNotification;
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function readLastSeenAt(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function writeLastSeenAt(value: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

export function countUnread(
  notifications: CustomerNotification[],
  lastSeen: number,
): number {
  return notifications.filter((note) => note.timestamp > lastSeen).length;
}
