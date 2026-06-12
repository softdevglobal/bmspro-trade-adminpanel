import { toIsoDateLocal } from "@/lib/calendar/events";
import type { BookingDetail } from "@/lib/bookings/types";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import { formatIsoDateInPlatformTimeZone } from "@/lib/platform/timezone";
import type { NotificationRecord } from "@/lib/notifications/types";

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

export type DashboardActivityItem = {
  id: string;
  text: string;
  createdAt: number;
  type: string;
  read: boolean;
};

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

function formatShortDate(iso: string): string {
  return formatIsoDateInPlatformTimeZone(iso, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function computeDashboardOverview(input: {
  bookings: BookingDetail[];
  requests: InspectionRequestDetail[];
  notifications: NotificationRecord[];
  staffCount: number;
  today?: Date;
}): DashboardOverview {
  const todayIso = toIsoDateLocal(input.today ?? new Date());

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

  const activity: DashboardActivityItem[] = input.notifications
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8)
    .map((note) => ({
      id: note.id,
      text: note.title.trim() || note.body.trim() || "Activity update",
      createdAt: note.createdAt,
      type: note.type,
      read: note.read,
    }));

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
        dateLabel: formatShortDate(date),
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
        dateLabel: formatShortDate(date),
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
  } else if (ongoingCount > 0) {
    focusMessage = `${ongoingCount} job${ongoingCount === 1 ? " is" : "s are"} live on site right now.`;
  } else if (todayTotal > 0) {
    focusMessage = `You have ${todayTotal} appointment${todayTotal === 1 ? "" : "s"} scheduled for today.`;
  }

  return { kpis, pipeline, activity, upcoming, focusMessage };
}
