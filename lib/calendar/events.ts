import type {
  InspectionRequestDetail,
  InspectionRequestStatus,
} from "@/lib/inspection/types";

export type CalendarSource = "inspection_visits" | "bookings";

export type DotColor = "primary" | "error" | "amber-500" | "green-500";

export type CalendarEvent = {
  key: string;
  requestId: string;
  request: InspectionRequestDetail;
  date: string;
  dotColor: DotColor;
};

export type CalendarStat = {
  label: string;
  value: number;
  labelClass: string;
  valueClass: string;
};

export const DOT_CLASS: Record<DotColor, string> = {
  primary: "bg-primary",
  error: "bg-error",
  "amber-500": "bg-amber-500",
  "green-500": "bg-green-500",
};

export function toIsoDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoDateFromParts(viewMonth: Date, day: number): string {
  const year = viewMonth.getFullYear();
  const month = String(viewMonth.getMonth() + 1).padStart(2, "0");
  const dayPart = String(day).padStart(2, "0");
  return `${year}-${month}-${dayPart}`;
}

export function requestTitle(request: InspectionRequestDetail): string {
  return request.requestType === "existing_service"
    ? request.serviceName ?? "Existing service"
    : request.customRequest?.title ?? "Custom quotation request";
}

export function dotColorForRequest(
  request: InspectionRequestDetail,
): DotColor {
  if (request.status === "completed") return "green-500";
  if (request.status === "cancelled") return "error";
  if (request.status === "pending" || request.status === "owner_proposed") {
    return "amber-500";
  }
  if (request.status === "scheduled" && !request.assignedTo) {
    return "amber-500";
  }
  return "primary";
}

export function matchesCalendarSource(
  request: InspectionRequestDetail,
  source: CalendarSource,
): boolean {
  if (request.status === "cancelled") return false;
  if (source === "inspection_visits") {
    return request.status === "pending" || request.status === "owner_proposed";
  }
  return request.status === "scheduled" || request.status === "completed";
}

export function datesForRequestOnCalendar(
  request: InspectionRequestDetail,
  source: CalendarSource,
): string[] {
  if (!matchesCalendarSource(request, source)) return [];

  if (source === "bookings") {
    return request.scheduledSlot?.date ? [request.scheduledSlot.date] : [];
  }

  if (request.status === "owner_proposed") {
    return request.ownerProposedSlots.map((slot) => slot.date);
  }

  return request.preferredSlots.map((slot) => slot.date);
}

export type AssigneeFilter = {
  assignedToMe: boolean;
  selectedStaffId: string | null;
  currentUserId: string | null;
};

export type CalendarStatusFilterKey =
  | "confirmed"
  | "unassigned"
  | "needs_review";

export type CalendarFilters = {
  assignee: AssigneeFilter;
  statusKeys: Set<CalendarStatusFilterKey>;
  serviceKeys: Set<string>;
  serviceAreas: Set<string>;
};

export const CUSTOM_SERVICE_KEY = "custom";

export function emptyCalendarFilters(
  currentUserId: string | null,
): CalendarFilters {
  return {
    assignee: {
      assignedToMe: false,
      selectedStaffId: null,
      currentUserId,
    },
    statusKeys: new Set(),
    serviceKeys: new Set(),
    serviceAreas: new Set(),
  };
}

export function matchesAssigneeFilter(
  request: InspectionRequestDetail,
  filter: AssigneeFilter,
): boolean {
  if (filter.assignedToMe) {
    if (!filter.currentUserId) return false;
    return request.assignedTo?.uid === filter.currentUserId;
  }
  if (filter.selectedStaffId) {
    return request.assignedTo?.uid === filter.selectedStaffId;
  }
  return true;
}

export function matchesStatusFilter(
  request: InspectionRequestDetail,
  keys: Set<CalendarStatusFilterKey>,
): boolean {
  if (keys.size === 0) return true;

  const isConfirmed =
    request.status === "scheduled" && request.assignedTo != null;
  const isUnassigned =
    (request.status === "scheduled" && !request.assignedTo) ||
    ((request.status === "pending" || request.status === "owner_proposed") &&
      !request.assignedTo);
  const isNeedsReview =
    request.status === "pending" || request.status === "owner_proposed";

  if (keys.has("confirmed") && isConfirmed) return true;
  if (keys.has("unassigned") && isUnassigned) return true;
  if (keys.has("needs_review") && isNeedsReview) return true;
  return false;
}

export function matchesServiceFilter(
  request: InspectionRequestDetail,
  keys: Set<string>,
): boolean {
  if (keys.size === 0) return true;
  if (
    request.requestType === "custom_quote" &&
    keys.has(CUSTOM_SERVICE_KEY)
  ) {
    return true;
  }
  if (
    request.requestType === "existing_service" &&
    request.serviceId &&
    keys.has(request.serviceId)
  ) {
    return true;
  }
  return false;
}

export function matchesServiceAreaFilter(
  request: InspectionRequestDetail,
  areas: Set<string>,
): boolean {
  if (areas.size === 0) return true;
  const suburb = request.address.suburb.trim().toLowerCase();
  if (!suburb) return false;
  for (const area of areas) {
    if (suburb === area.trim().toLowerCase()) return true;
  }
  return false;
}

export function matchesCalendarFilters(
  request: InspectionRequestDetail,
  filters: CalendarFilters,
): boolean {
  return (
    matchesAssigneeFilter(request, filters.assignee) &&
    matchesStatusFilter(request, filters.statusKeys) &&
    matchesServiceFilter(request, filters.serviceKeys) &&
    matchesServiceAreaFilter(request, filters.serviceAreas)
  );
}

export function buildCalendarEvents(
  requests: InspectionRequestDetail[],
  source: CalendarSource,
  filters: CalendarFilters,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const request of requests) {
    if (!matchesCalendarSource(request, source)) continue;
    if (!matchesCalendarFilters(request, filters)) continue;

    const dates = datesForRequestOnCalendar(request, source);
    const dotColor = dotColorForRequest(request);

    for (const date of dates) {
      events.push({
        key: `${request.id}-${date}`,
        requestId: request.id,
        request,
        date,
        dotColor,
      });
    }
  }

  return events;
}

export function groupEventsByDate(
  events: CalendarEvent[],
): Record<string, CalendarEvent[]> {
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const event of events) {
    if (!grouped[event.date]) grouped[event.date] = [];
    grouped[event.date].push(event);
  }
  return grouped;
}

export function computeCalendarStats(
  requests: InspectionRequestDetail[],
  source: CalendarSource,
  todayIso: string,
  filters: CalendarFilters,
): CalendarStat[] {
  const scoped = requests.filter(
    (request) =>
      matchesCalendarSource(request, source) &&
      matchesCalendarFilters(request, filters),
  );

  const events = buildCalendarEvents(scoped, source, {
    ...filters,
    assignee: {
      assignedToMe: false,
      selectedStaffId: null,
      currentUserId: filters.assignee.currentUserId,
    },
  });

  const todayEvents = events.filter((event) => event.date === todayIso);
  const todayRequestIds = new Set(todayEvents.map((event) => event.requestId));

  const unassigned = scoped.filter(
    (request) => request.status === "scheduled" && !request.assignedTo,
  ).length;

  const needsReview = scoped.filter(
    (request) =>
      request.status === "pending" || request.status === "owner_proposed",
  ).length;

  const urgent = scoped.filter((request) => request.status === "pending").length;

  const done = scoped.filter((request) => request.status === "completed").length;

  const cancelled = requests.filter(
    (request) => request.status === "cancelled",
  ).length;

  return [
    {
      label: "Today",
      value: todayRequestIds.size,
      labelClass: "text-outline",
      valueClass: "text-primary",
    },
    {
      label: "Unassigned",
      value: unassigned,
      labelClass: "text-amber-600",
      valueClass: "text-amber-600",
    },
    {
      label: "Needs Review",
      value: needsReview,
      labelClass: "text-amber-500",
      valueClass: "text-amber-500",
    },
    {
      label: "Urgent",
      value: urgent,
      labelClass: "text-error",
      valueClass: "text-error",
    },
    {
      label: "Done",
      value: done,
      labelClass: "text-green-600",
      valueClass: "text-green-600",
    },
    {
      label: "Cancelled",
      value: cancelled,
      labelClass: "text-outline",
      valueClass: "text-outline",
    },
  ];
}

export function sourceSummaryCounts(
  requests: InspectionRequestDetail[],
  source: CalendarSource,
  todayIso: string,
): { today: number; unassigned: number } {
  const stats = computeCalendarStats(requests, source, todayIso, {
    assignee: {
      assignedToMe: false,
      selectedStaffId: null,
      currentUserId: null,
    },
    statusKeys: new Set(),
    serviceKeys: new Set(),
    serviceAreas: new Set(),
  });
  return {
    today: stats[0]?.value ?? 0,
    unassigned: stats[1]?.value ?? 0,
  };
}

export const CALENDAR_STATUS_TONE: Record<InspectionRequestStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border border-amber-200",
  owner_proposed: "bg-violet-50 text-violet-700 border border-violet-200",
  scheduled: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  cancelled: "bg-stone-100 text-stone-600 border border-stone-200",
  completed: "bg-sky-50 text-sky-700 border border-sky-200",
};
