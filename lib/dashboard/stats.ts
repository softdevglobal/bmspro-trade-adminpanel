import type { BookingDetail } from "@/lib/bookings/types";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import {
  formatIsoDateInPlatformTimeZone,
  platformTodayIso,
} from "@/lib/platform/timezone";
import type {
  NotificationRecord,
  NotificationType,
} from "@/lib/notifications/types";

export type DashboardKpi = {
  key: string;
  label: string;
  value: string;
  icon: string;
  trend: string;
  accent: "blue" | "amber" | "violet" | "emerald";
};

export type DashboardPipelineStage = {
  key: string;
  label: string;
  value: number;
  icon: string;
};

/** High-level Live feed grouping for owner filters. */
export type DashboardActivityCategory = "customer" | "staff" | "other";

export type DashboardActivityItem = {
  id: string;
  text: string;
  body: string;
  createdAt: number;
  type: string;
  read: boolean;
  category: DashboardActivityCategory;
  customerName: string | null;
  staffName: string | null;
};

const STAFF_NOTIFICATION_TYPES = new Set<NotificationType>([
  "leave_requested",
  "leave_assignment_conflict",
  "staff_off_day",
  "request_assigned",
]);

const CUSTOMER_NOTIFICATION_TYPES = new Set<NotificationType>([
  "request_created",
  "request_scheduled",
  "request_proposed",
  "request_cancelled",
  "request_completed",
  "visit_on_the_way",
  "booking_on_the_way",
  "job_completed",
  "invoice_sent",
  "quotation_sent",
  "quotation_accepted",
  "quotation_rejected",
]);

export function activityCategoryForType(
  type: string,
): DashboardActivityCategory {
  if (STAFF_NOTIFICATION_TYPES.has(type as NotificationType)) return "staff";
  if (CUSTOMER_NOTIFICATION_TYPES.has(type as NotificationType)) {
    return "customer";
  }
  return "other";
}

/** Match a known staff name mentioned in notification copy (longest first). */
export function resolveStaffNameFromText(
  text: string,
  staffNames: string[],
): string | null {
  const haystack = text.trim().toLowerCase();
  if (!haystack || staffNames.length === 0) return null;

  const sorted = staffNames
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const name of sorted) {
    if (haystack.includes(name.toLowerCase())) return name;
  }
  return null;
}

export function mapNotificationToActivityItem(
  note: NotificationRecord,
  staffNames: string[] = [],
): DashboardActivityItem {
  const title = note.title.trim();
  const body = note.body.trim();
  const category = activityCategoryForType(note.type);
  const staffName =
    category === "staff"
      ? resolveStaffNameFromText(`${title} ${body}`, staffNames)
      : null;

  return {
    id: note.id,
    text: title || body || "Activity update",
    body: title ? body : "",
    createdAt: note.createdAt,
    type: note.type,
    read: note.read,
    category,
    customerName: note.customerName?.trim() || null,
    staffName,
  };
}

export function buildLiveFeedActivity(
  notifications: NotificationRecord[],
  options?: {
    staffNames?: string[];
    category?: DashboardActivityCategory | "all";
    staffName?: string | null;
    limit?: number;
  },
): DashboardActivityItem[] {
  const staffNames = options?.staffNames ?? [];
  const category = options?.category ?? "all";
  const staffNameFilter = options?.staffName?.trim().toLowerCase() || null;
  const limit = options?.limit ?? 12;

  return notifications
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((note) => mapNotificationToActivityItem(note, staffNames))
    .filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (category === "staff" && staffNameFilter) {
        return item.staffName?.toLowerCase() === staffNameFilter;
      }
      return true;
    })
    .slice(0, limit);
}

export type DashboardUpcomingItem = {
  id: string;
  kind: "booking" | "visit";
  title: string;
  dateLabel: string;
  statusLabel: string;
  href: string;
};

export type DashboardOverview = {
  kpis: DashboardKpi[];
  pipeline: DashboardPipelineStage[];
  activity: DashboardActivityItem[];
  upcoming: DashboardUpcomingItem[];
  focusMessage: string | null;
};

function isTodayBooking(booking: BookingDetail, todayIso: string): boolean {
  if (booking.status !== "scheduled" && booking.status !== "ongoing") {
    return false;
  }
  return booking.scheduledSlot?.date === todayIso;
}

function isTodayVisit(request: InspectionRequestDetail, todayIso: string): boolean {
  if (request.status !== "scheduled") return false;
  return request.scheduledSlot?.date === todayIso;
}

function bookingTitle(booking: BookingDetail): string {
  return (
    booking.serviceName ??
    booking.customRequest?.title ??
    "Scheduled job"
  );
}

function visitTitle(request: InspectionRequestDetail): string {
  return request.requestType === "existing_service"
    ? (request.serviceName ?? "Request")
    : (request.customRequest?.title ?? "Custom quote visit");
}

function formatShortDate(iso: string, timeZone?: string | null): string {
  return formatIsoDateInPlatformTimeZone(
    iso,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
    },
    timeZone,
  );
}

export function computeDashboardOverview(input: {
  bookings: BookingDetail[];
  requests: InspectionRequestDetail[];
  notifications: NotificationRecord[];
  staffCount: number;
  today?: Date;
  timeZone?: string | null;
}): DashboardOverview {
  const todayIso = platformTodayIso(input.today ?? new Date(), input.timeZone);

  const todayBookings = input.bookings.filter((booking) =>
    isTodayBooking(booking, todayIso),
  ).length;
  const todayVisits = input.requests.filter((request) =>
    isTodayVisit(request, todayIso),
  ).length;
  const todayTotal = todayBookings + todayVisits;
  const ongoingCount = input.bookings.filter(
    (booking) => booking.status === "ongoing",
  ).length;

  const unassignedBookings = input.bookings.filter(
    (booking) => booking.status === "scheduled" && !booking.assignedTo,
  ).length;
  const unassignedVisits = input.requests.filter((request) => {
    if (request.assignedTo) return false;
    return (
      request.status === "scheduled" ||
      request.status === "pending" ||
      request.status === "owner_proposed"
    );
  }).length;
  const unassignedTotal = unassignedBookings + unassignedVisits;
  const urgentPending = input.requests.filter(
    (request) => request.status === "pending" && !request.assignedTo,
  ).length;

  // A job can be completed without invoicing. Surface finished jobs that still
  // have no invoice so the owner doesn't miss billing the customer.
  const awaitingInvoice = input.requests.filter(
    (request) => request.status === "completed" && !request.invoice,
  ).length;

  const unread = input.notifications.filter((note) => !note.read).length;
  const messageTotal = input.notifications.length;
  const staffCount = input.staffCount;

  const pendingCount = input.requests.filter(
    (request) =>
      request.status === "pending" || request.status === "owner_proposed",
  ).length;
  const scheduledCount =
    input.bookings.filter((booking) => booking.status === "scheduled").length +
    input.requests.filter((request) => request.status === "scheduled").length;
  const completedCount =
    input.bookings.filter((booking) => booking.status === "completed").length +
    input.requests.filter((request) => request.status === "completed").length;

  const kpis: DashboardKpi[] = [
    {
      key: "today",
      label: "Today on the calendar",
      value: String(todayTotal),
      icon: "today",
      accent: "blue",
      trend:
        ongoingCount > 0
          ? `${ongoingCount} job${ongoingCount === 1 ? "" : "s"} in progress`
          : todayTotal > 0
            ? `${todayBookings} job${todayBookings === 1 ? "" : "s"} · ${todayVisits} visit${todayVisits === 1 ? "" : "s"}`
            : "Clear day ahead",
    },
    {
      key: "unassigned",
      label: "Needs assignment",
      value: String(unassignedTotal),
      icon: "person_add",
      accent: "amber",
      trend:
        urgentPending > 0
          ? `${urgentPending} awaiting review`
          : unassignedTotal > 0
            ? "Assign your team"
            : "Fully covered",
    },
    {
      key: "awaiting_invoice",
      label: "Awaiting invoice",
      value: String(awaitingInvoice),
      icon: "receipt_long",
      accent: "amber",
      trend:
        awaitingInvoice > 0
          ? `${awaitingInvoice} job${awaitingInvoice === 1 ? "" : "s"} to bill`
          : "All invoiced",
    },
    {
      key: "messages",
      label: "Inbox",
      value: String(messageTotal),
      icon: "notifications",
      accent: "violet",
      trend: unread > 0 ? `${unread} unread` : "Caught up",
    },
    {
      key: "team",
      label: "Active team",
      value: String(staffCount),
      icon: "groups",
      accent: "emerald",
      trend:
        staffCount === 0
          ? "Invite your first tech"
          : `${staffCount} member${staffCount === 1 ? "" : "s"}`,
    },
  ];

  const pipeline: DashboardPipelineStage[] = [
    { key: "pending", label: "Pending", value: pendingCount, icon: "hourglass_top" },
    { key: "scheduled", label: "Scheduled", value: scheduledCount, icon: "event" },
    { key: "ongoing", label: "Ongoing", value: ongoingCount, icon: "engineering" },
    { key: "done", label: "Completed", value: completedCount, icon: "task_alt" },
  ];

  const activity = buildLiveFeedActivity(input.notifications, { limit: 8 });

  const upcomingCandidates: Array<{
    sortKey: string;
    item: DashboardUpcomingItem;
  }> = [];

  for (const booking of input.bookings) {
    const date = booking.scheduledSlot?.date;
    if (
      !date ||
      date < todayIso ||
      (booking.status !== "scheduled" && booking.status !== "ongoing")
    ) {
      continue;
    }
    upcomingCandidates.push({
      sortKey: date,
      item: {
        id: booking.id,
        kind: "booking",
        title: bookingTitle(booking),
        dateLabel: formatShortDate(date, input.timeZone),
        statusLabel:
          booking.status === "ongoing" ? "Ongoing" : "Scheduled",
        href: "/dashboard/jobs",
      },
    });
  }

  for (const request of input.requests) {
    const date = request.scheduledSlot?.date;
    if (!date || date < todayIso || request.status !== "scheduled") continue;
    upcomingCandidates.push({
      sortKey: date,
      item: {
        id: request.id,
        kind: "visit",
        title: visitTitle(request),
        dateLabel: formatShortDate(date, input.timeZone),
        statusLabel: "Inspection",
        href: `/dashboard/requests?request=${request.id}`,
      },
    });
  }

  const upcoming = upcomingCandidates
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .slice(0, 4)
    .map((entry) => entry.item);

  let focusMessage: string | null = null;
  if (urgentPending > 0) {
    focusMessage = `${urgentPending} new request${urgentPending === 1 ? "" : "s"} need your review.`;
  } else if (unassignedTotal > 0) {
    focusMessage = `${unassignedTotal} job${unassignedTotal === 1 ? "" : "s"} still need someone assigned.`;
  } else if (awaitingInvoice > 0) {
    focusMessage = `${awaitingInvoice} completed job${awaitingInvoice === 1 ? "" : "s"} still need an invoice sent.`;
  } else if (ongoingCount > 0) {
    focusMessage = `${ongoingCount} job${ongoingCount === 1 ? " is" : "s are"} live on site right now.`;
  } else if (todayTotal > 0) {
    focusMessage = `You have ${todayTotal} appointment${todayTotal === 1 ? "" : "s"} scheduled for today.`;
  }

  return { kpis, pipeline, activity, upcoming, focusMessage };
}
