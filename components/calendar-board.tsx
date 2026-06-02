"use client";

import {
  formatAddress,
  formatInspectionVisitReference,
  STATUS_LABELS,
  TIME_RANGE_SHORT_LABELS,
  formatVisitWindow,
} from "@/lib/inspection/types";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  buildMonthGridCalendarEvents,
  CALENDAR_SOURCE_LABELS,
  CALENDAR_STATUS_TONE,
  computeCombinedCalendarStats,
  CUSTOM_SERVICE_KEY,
  DOT_CLASS,
  emptyCalendarFilters,
  groupEventsByDate,
  isoDateFromParts,
  requestTitle,
  toIsoDateLocal,
  type CalendarFilters,
  type CalendarStatusFilterKey,
} from "@/lib/calendar/events";
import { useCalendarFilterOptions } from "@/lib/calendar/use-calendar-filter-options";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { useAuth } from "@/lib/auth/auth-context";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const VIEW_TABS = ["Today", "Week", "Month"] as const;

const VIEW_TOGGLE_PILL =
  "pointer-events-none absolute inset-0 rounded-lg bg-primary shadow-sm shadow-primary/20";

const TOGGLE_SPRING = { type: "spring" as const, stiffness: 500, damping: 35 };

const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const MONTH_FORMAT = new Intl.DateTimeFormat("en-AU", {
  month: "long",
  year: "numeric",
});

const DAY_FORMAT = new Intl.DateTimeFormat("en-AU", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** Matches service-detail-drawer: curved left edge, inset width, and max width on mobile. */
const MOBILE_DRAWER_PANEL_CLASS =
  "absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-md flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl transition-transform duration-300 will-change-transform sm:w-full sm:rounded-none sm:border-y-0 sm:border-r-0 sm:border-l";

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/** Monday-based offset (0 = Monday … 6 = Sunday). */
function mondayOffset(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function eventTimeLabel(
  request: import("@/lib/inspection/types").InspectionRequestDetail,
  date: string,
): string {
  if (request.scheduledSlot?.date === date) {
    const window = formatVisitWindow(
      request.scheduledStartTime,
      request.scheduledEndTime,
    );
    if (window) return window;
    return TIME_RANGE_SHORT_LABELS[request.scheduledSlot.timeRange];
  }

  const proposed = request.ownerProposedSlots.find((slot) => slot.date === date);
  if (proposed) return TIME_RANGE_SHORT_LABELS[proposed.timeRange];

  const preferred = request.preferredSlots.find((slot) => slot.date === date);
  if (preferred) return TIME_RANGE_SHORT_LABELS[preferred.timeRange];

  return "Time TBC";
}

export function CalendarBoard() {
  const { user } = useAuth();
  const {
    requests,
    loading: requestsLoading,
    error: requestsError,
  } = useInspectionRequests();
  const { staff, loading: staffLoading } = useBusinessStaffSummary();
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => toIsoDateLocal(today), [today]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));
  const [viewTab, setViewTab] = useState<(typeof VIEW_TABS)[number]>("Month");
  const [bookingDrawerOpen, setBookingDrawerOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [selectedIsoDate, setSelectedIsoDate] = useState<string | null>(null);
  const [filters, setFilters] = useState<CalendarFilters>(() =>
    emptyCalendarFilters(null),
  );

  const {
    services: serviceOptions,
    serviceAreas,
    loading: filterOptionsLoading,
  } = useCalendarFilterOptions(filterDrawerOpen);

  useEffect(() => {
    setFilters((current) => ({
      ...current,
      assignee: {
        ...current.assignee,
        currentUserId: user?.uid ?? null,
      },
    }));
  }, [user?.uid]);

  const monthGridEvents = useMemo(
    () => buildMonthGridCalendarEvents(requests, filters),
    [requests, filters],
  );

  const monthEventsByDate = useMemo(
    () => groupEventsByDate(monthGridEvents),
    [monthGridEvents],
  );

  const stats = useMemo(
    () => computeCombinedCalendarStats(requests, todayIso, filters),
    [requests, todayIso, filters],
  );

  const unassignedCount = stats[1]?.value ?? 0;

  const selectedDayEvents = selectedIsoDate
    ? (monthEventsByDate[selectedIsoDate] ?? [])
    : [];

  const monthLabel = MONTH_FORMAT.format(viewMonth);
  const leadingBlanks = mondayOffset(viewMonth);
  const totalDays = daysInMonth(viewMonth);

  const selectedDate = selectedIsoDate
    ? new Date(`${selectedIsoDate}T12:00:00`)
    : null;

  useEffect(() => {
    if (!bookingDrawerOpen && !filterDrawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [bookingDrawerOpen, filterDrawerOpen]);

  function openDay(day: number) {
    setSelectedIsoDate(isoDateFromParts(viewMonth, day));
    setBookingDrawerOpen(true);
  }

  function handleViewTab(tab: (typeof VIEW_TABS)[number]) {
    setViewTab(tab);
    if (tab === "Today") {
      setViewMonth(startOfMonth(today));
    }
  }

  function closeBookingDrawer() {
    setBookingDrawerOpen(false);
  }

  function toggleAssignedToMe(checked: boolean) {
    setFilters((current) => ({
      ...current,
      assignee: {
        ...current.assignee,
        assignedToMe: checked,
        selectedStaffId: checked ? null : current.assignee.selectedStaffId,
      },
    }));
  }

  function toggleStaffMember(staffId: string, checked: boolean) {
    setFilters((current) => ({
      ...current,
      assignee: {
        ...current.assignee,
        assignedToMe: checked ? false : current.assignee.assignedToMe,
        selectedStaffId: checked
          ? staffId
          : current.assignee.selectedStaffId === staffId
            ? null
            : current.assignee.selectedStaffId,
      },
    }));
  }

  function toggleStatusFilter(key: CalendarStatusFilterKey) {
    setFilters((current) => {
      const next = new Set(current.statusKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, statusKeys: next };
    });
  }

  function toggleServiceFilter(key: string) {
    setFilters((current) => {
      const next = new Set(current.serviceKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...current, serviceKeys: next };
    });
  }

  function toggleServiceArea(area: string) {
    setFilters((current) => {
      const next = new Set(current.serviceAreas);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return { ...current, serviceAreas: next };
    });
  }

  function clearAllFilters() {
    setFilters(emptyCalendarFilters(user?.uid ?? null));
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {requestsError ? (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{requestsError}</span>
        </div>
      ) : null}

      {!requestsLoading && !requestsError && requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest p-6 text-center">
          <p className="font-body text-[14px] font-semibold text-on-surface">
            No inspection requests yet
          </p>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            Requests from your booking page and owner-created visits will appear
            on the calendar.
          </p>
          <Link
            href="/dashboard/inspection-visits"
            className="mt-3 inline-flex items-center gap-1 font-body text-[13px] font-semibold text-primary hover:underline"
          >
            Go to Inspection visits
            <span className="material-symbols-outlined text-[16px]">
              arrow_forward
            </span>
          </Link>
        </div>
      ) : null}

      {/* Summary row */}
      <section className="grid grid-cols-2 gap-2 sm:gap-base md:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest p-3 sm:p-4"
          >
            <span
              className={`font-body text-[10px] font-semibold uppercase tracking-wide ${stat.labelClass}`}
            >
              {stat.label}
            </span>
            <span
              className={`font-numeric text-[24px] font-bold sm:text-display-md ${stat.valueClass}`}
            >
              {String(stat.value).padStart(2, "0")}
            </span>
          </div>
        ))}
      </section>

      {/* Filters & view tabs */}
      <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
          <div
            role="tablist"
            aria-label="Calendar timeframe"
            className="relative flex shrink-0 gap-0.5 rounded-xl border border-outline-variant bg-surface-container-low p-1"
          >
            {VIEW_TABS.map((tab) => {
              const active = viewTab === tab;

              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleViewTab(tab)}
                  className={`relative z-10 shrink-0 rounded-lg px-4 py-2 font-body text-[13px] font-semibold whitespace-nowrap transition-colors duration-300 ease-out ${
                    active
                      ? "text-on-primary"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {active ? (
                    <motion.span
                      layoutId="calendar-view-toggle-pill"
                      className={VIEW_TOGGLE_PILL}
                      transition={TOGGLE_SPRING}
                    />
                  ) : null}
                  <span className="relative z-10">{tab}</span>
                </button>
              );
            })}
          </div>
          <div className="mx-1 hidden h-8 w-px shrink-0 bg-outline-variant sm:block" />
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 rounded-lg bg-amber-100 px-4 py-2 font-body text-[13px] font-semibold whitespace-nowrap text-amber-800"
          >
            Unassigned
            <span className="rounded-full bg-amber-600 px-2 py-0.5 font-numeric text-[10px] text-white">
              {unassignedCount}
            </span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setFilterDrawerOpen(true)}
          className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-outline-variant px-4 py-2 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined text-[20px]">filter_list</span>
          Filters
        </button>
      </section>

      {/* Calendar */}
      <section className="relative flex flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        {requestsLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur-[1px]">
            <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
              progress_activity
            </span>
          </div>
        ) : null}
        <div className="flex flex-col gap-4 border-b border-outline-variant p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-4">
            <h3 className="font-display text-[22px] font-semibold text-on-surface sm:text-display-md">
              {monthLabel}
            </h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setViewMonth((current) => addMonths(current, -1))}
                className="rounded-lg p-1 transition-colors hover:bg-surface-container"
                aria-label="Previous month"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMonth((current) => addMonths(current, 1))}
                className="rounded-lg p-1 transition-colors hover:bg-surface-container"
                aria-label="Next month"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {[
              { color: "bg-primary", label: "Bookings" },
              { color: "bg-green-500", label: "Inspection visits" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-2 font-body text-[12px] font-semibold text-on-surface-variant"
              >
                <span className={`h-3 w-3 rounded-full ${item.color}`} />
                {item.label}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-7">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="border-b border-r border-outline-variant bg-surface-container-low p-2 text-center font-body text-[11px] font-semibold tracking-wide text-outline sm:p-3 sm:text-[12px]"
            >
              {label}
            </div>
          ))}

          {Array.from({ length: leadingBlanks }).map((_, index) => (
            <div
              key={`blank-${index}`}
              className="min-h-[88px] border-b border-r border-outline-variant bg-surface/30 sm:min-h-[120px]"
            />
          ))}

          {Array.from({ length: totalDays }).map((_, index) => {
            const day = index + 1;
            const isoDate = isoDateFromParts(viewMonth, day);
            const cellDate = new Date(`${isoDate}T12:00:00`);
            const isToday = isSameDay(cellDate, today);
            const dayEvents = monthEventsByDate[isoDate] ?? [];

            return (
              <button
                key={day}
                type="button"
                onClick={() => openDay(day)}
                className={`group flex min-h-[88px] cursor-pointer flex-col justify-between border-b border-r border-outline-variant p-2 text-left transition-colors hover:bg-surface-container-low active:scale-[0.99] sm:min-h-[120px] sm:p-3 ${
                  isToday ? "bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span
                    className={`font-numeric text-base font-bold sm:text-lg ${
                      isToday
                        ? "flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary"
                        : "text-on-surface"
                    }`}
                  >
                    {day}
                  </span>
                  {dayEvents.length > 0 ? (
                    <span className="font-numeric text-[10px] font-bold text-outline-variant group-hover:text-primary">
                      {dayEvents.length}{" "}
                      {dayEvents.length === 1 ? "item" : "items"}
                    </span>
                  ) : null}
                </div>
                {dayEvents.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {dayEvents.map((event) => (
                      <span
                        key={event.key}
                        className={`h-2 w-2 rounded-full ${DOT_CLASS[event.dotColor]}`}
                      />
                    ))}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {/* Booking drawer */}
      <div
        className={`fixed inset-0 z-[100] ${
          bookingDrawerOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close booking details"
          onClick={closeBookingDrawer}
          className={`absolute inset-0 bg-on-background/45 backdrop-blur-[2px] transition-opacity ${
            bookingDrawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          className={`${MOBILE_DRAWER_PANEL_CLASS} ${
            bookingDrawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-outline-variant p-5">
            <div>
              <h3 className="font-display text-headline-sm font-bold text-on-surface">
                {selectedDate ? DAY_FORMAT.format(selectedDate) : "Calendar"}
              </h3>
              <p className="font-body text-[13px] font-semibold text-on-surface-variant">
                {selectedDayEvents.length > 0
                  ? `${selectedDayEvents.length} ${selectedDayEvents.length === 1 ? "item" : "items"} on this day`
                  : "Nothing scheduled on this day"}
              </p>
            </div>
            <button
              type="button"
              onClick={closeBookingDrawer}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-surface-container"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 p-5">
            {selectedDayEvents.length > 0 ? (
              selectedDayEvents.map((event) => {
                const { request } = event;
                const title = requestTitle(request);
                const timeLabel = eventTimeLabel(request, event.date);
                const assignee = request.assignedTo;

                const sourceLabel = CALENDAR_SOURCE_LABELS[event.source];
                const sourceTone =
                  event.source === "bookings"
                    ? "bg-primary/10 text-primary border border-primary/25"
                    : "bg-green-50 text-green-700 border border-green-200";

                return (
                  <article
                    key={event.key}
                    className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding transition-all hover:border-primary hover:shadow-md"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${sourceTone}`}
                        >
                          {sourceLabel}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${CALENDAR_STATUS_TONE[request.status]}`}
                        >
                          {STATUS_LABELS[request.status]}
                        </span>
                      </div>
                      <span className="shrink-0 font-numeric font-bold text-on-surface">
                        {timeLabel}
                      </span>
                    </div>
                    <h4 className="font-display text-lg font-bold text-on-surface">
                      {title}
                    </h4>
                    <p className="mt-1 font-body text-sm text-on-surface-variant">
                      {formatAddress(request.address)} · Ref{" "}
                      {formatInspectionVisitReference(request.id)}
                    </p>
                    <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                      {request.customer.fullName}
                    </p>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      {assignee ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={staffAvatarUrl({
                                id: assignee.uid,
                                email: assignee.email ?? assignee.name,
                                fullName: assignee.name,
                              })}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </span>
                          <div className="min-w-0">
                            <span className="block truncate font-body text-sm font-bold text-on-surface">
                              {assignee.name}
                            </span>
                            <span className="rounded bg-slate-700 px-2 py-0.5 font-body text-[10px] font-semibold uppercase text-white">
                              {assignee.type === "owner" ? "Owner" : "Staff"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="font-body text-[12px] font-semibold text-amber-700">
                          Unassigned
                        </span>
                      )}
                      <Link
                        href={`/dashboard/inspection-visits?request=${request.id}`}
                        className="shrink-0 font-body text-[13px] font-semibold text-primary hover:underline"
                        onClick={closeBookingDrawer}
                      >
                        Open
                      </Link>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-outline-variant px-4 py-10 text-center">
                <span className="material-symbols-outlined text-[36px] text-outline-variant">
                  event_busy
                </span>
                <p className="mt-3 font-body text-[14px] text-on-surface-variant">
                  Nothing on this day yet.
                </p>
              </div>
            )}
            </div>
          </div>
        </aside>
      </div>

      {/* Filter drawer */}
      <div
        className={`fixed inset-0 z-[100] ${
          filterDrawerOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <button
          type="button"
          aria-label="Close filters"
          onClick={() => setFilterDrawerOpen(false)}
          className={`absolute inset-0 bg-on-background/45 backdrop-blur-[2px] transition-opacity ${
            filterDrawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          className={`${MOBILE_DRAWER_PANEL_CLASS} ${
            filterDrawerOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-outline-variant p-5">
            <h3 className="font-display text-headline-sm font-bold text-on-surface">
              Filters
            </h3>
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-surface-container"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto p-5">
            <div className="space-y-3">
              <p className="font-body text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Booking status
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["confirmed", "Confirmed"],
                    ["unassigned", "Unassigned"],
                    ["needs_review", "Needs Review"],
                  ] as const
                ).map(([key, label]) => {
                  const checked = filters.statusKeys.has(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleStatusFilter(key)}
                      className={`rounded-full border px-3 py-1 font-body text-sm transition-colors ${
                        checked
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <p className="font-body text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Assignee
              </p>

              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-outline-variant p-3 transition-colors hover:bg-surface-container-low">
                <input
                  type="checkbox"
                  checked={filters.assignee.assignedToMe}
                  onChange={(event) => toggleAssignedToMe(event.target.checked)}
                  className="h-5 w-5 rounded border-outline-variant text-primary focus:ring-primary"
                />
                <span className="font-body text-[13px] font-semibold text-on-surface">
                  Assigned to me
                </span>
              </label>

              <div className="space-y-2">
                <p className="font-body text-[12px] font-semibold text-on-surface-variant">
                  Staff
                </p>
                <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-outline-variant p-2">
                  {staffLoading ? (
                    <p className="px-2 py-3 text-center font-body text-[13px] text-on-surface-variant">
                      Loading staff…
                    </p>
                  ) : staff.length === 0 ? (
                    <p className="px-2 py-3 text-center font-body text-[13px] text-on-surface-variant">
                      No staff members yet.
                    </p>
                  ) : (
                    staff.map((member) => {
                      const checked = filters.assignee.selectedStaffId === member.id;
                      return (
                        <label
                          key={member.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                            checked
                              ? "border-primary bg-primary/5"
                              : "border-outline-variant/60 hover:bg-surface-container-low"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleStaffMember(member.id, event.target.checked)
                            }
                            className="h-5 w-5 shrink-0 rounded border-outline-variant text-primary focus:ring-primary"
                          />
                          <span className="flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={staffAvatarUrl(member)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-body text-[13px] font-semibold text-on-surface">
                              {member.fullName}
                            </span>
                            <span className="block truncate font-body text-[11px] text-on-surface-variant">
                              {member.staffType}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="font-body text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Services
              </p>
              {filterOptionsLoading ? (
                <p className="font-body text-[13px] text-on-surface-variant">
                  Loading services…
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleServiceFilter(CUSTOM_SERVICE_KEY)}
                    className={`rounded-full border px-3 py-1.5 font-body text-[13px] font-semibold transition-colors ${
                      filters.serviceKeys.has(CUSTOM_SERVICE_KEY)
                        ? "border-primary bg-primary text-on-primary"
                        : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                    }`}
                  >
                    Custom requests
                  </button>
                  {serviceOptions.map((service) => (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => toggleServiceFilter(service.id)}
                      className={`rounded-full border px-3 py-1.5 font-body text-[13px] font-semibold transition-colors ${
                        filters.serviceKeys.has(service.id)
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                      } ${service.isActive ? "" : "opacity-70"}`}
                    >
                      {service.name}
                      {!service.isActive ? " (inactive)" : ""}
                    </button>
                  ))}
                  {serviceOptions.length === 0 ? (
                    <p className="font-body text-[13px] text-on-surface-variant">
                      No services yet. Add services from the Services page.
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <p className="font-body text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                Service areas
              </p>
              {filterOptionsLoading ? (
                <p className="font-body text-[13px] text-on-surface-variant">
                  Loading areas…
                </p>
              ) : serviceAreas.length === 0 ? (
                <p className="font-body text-[13px] text-on-surface-variant">
                  No service areas configured for your business yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {serviceAreas.map((area) => (
                    <button
                      key={area}
                      type="button"
                      onClick={() => toggleServiceArea(area)}
                      className={`rounded-full border px-3 py-1.5 font-body text-[13px] font-semibold transition-colors ${
                        filters.serviceAreas.has(area)
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                      }`}
                    >
                      {area}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 gap-4 border-t border-outline-variant p-5">
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(false)}
              className="flex-1 rounded-xl bg-primary py-3 font-body text-[13px] font-semibold text-on-primary shadow-lg transition-all hover:brightness-110 active:scale-95"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-xl bg-surface-container-high px-6 py-3 font-body text-[13px] font-semibold text-on-surface-variant transition-all hover:bg-surface-container-highest"
            >
              Clear
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
