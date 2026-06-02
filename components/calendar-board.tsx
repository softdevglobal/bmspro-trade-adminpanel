"use client";

import {
  formatAddress,
  TIME_RANGE_SHORT_LABELS,
  formatVisitWindow,
} from "@/lib/inspection/types";
import { useBookings } from "@/lib/bookings/use-bookings";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  bookingTitle,
  buildMonthGridCalendarEvents,
  calendarCardView,
  CALENDAR_SOURCE_CARD_CLASS,
  requestTitle,
  CALENDAR_SOURCE_LABELS,
  computeCombinedCalendarStats,
  CUSTOM_SERVICE_KEY,
  DOT_CLASS,
  emptyCalendarFilters,
  groupEventsByDate,
  isoDateFromParts,
  toIsoDateLocal,
  type CalendarEvent,
  type CalendarCardView,
  type CalendarFilters,
  type CalendarStatusFilterKey,
} from "@/lib/calendar/events";
import { useCalendarFilterOptions } from "@/lib/calendar/use-calendar-filter-options";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { useAuth } from "@/lib/auth/auth-context";
import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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

const WEEKDAY_LONG_FORMAT = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
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

function normalizeDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, delta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return normalizeDate(next);
}

function startOfWeekMonday(date: Date): Date {
  const normalized = normalizeDate(date);
  return addDays(normalized, -mondayOffset(normalized));
}

function weekDaysFromAnchor(anchor: Date): Date[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function formatWeekRange(anchor: Date): string {
  const days = weekDaysFromAnchor(anchor);
  const start = days[0]!;
  const end = days[6]!;
  if (
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear()
  ) {
    return `${start.getDate()} – ${end.getDate()} ${MONTH_FORMAT.format(start)}`;
  }
  const startFmt = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  });
  const endFmt = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startFmt.format(start)} – ${endFmt.format(end)}`;
}

function CalendarDetailRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="font-body text-[10px] font-bold uppercase tracking-wider text-outline">
        {label}
      </p>
      <div
        className={`mt-0.5 font-body text-[14px] leading-relaxed text-on-surface ${
          mono ? "font-mono text-[13px] tracking-wide" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function CalendarDayEventCards({
  events,
  onOpenLink,
}: {
  events: CalendarEvent[];
  onOpenLink?: () => void;
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant px-4 py-10 text-center">
        <span className="material-symbols-outlined text-[36px] text-outline-variant">
          event_busy
        </span>
        <p className="mt-3 font-body text-[14px] text-on-surface-variant">
          Nothing on this day yet.
        </p>
      </div>
    );
  }

  return (
    <>
      {events.map((event) => {
        const card = calendarCardView(event);
        if (!card) return null;

        const timeLabel = eventTimeLabel(card, event.date);
        const assignee = card.assignedTo;
        const sourceLabel = CALENDAR_SOURCE_LABELS[event.source];
        const sourceTone =
          event.source === "bookings"
            ? "bg-primary/10 text-primary border border-primary/25"
            : "bg-green-50 text-green-700 border border-green-200";

        return (
          <article
            key={event.key}
            className={CALENDAR_SOURCE_CARD_CLASS[event.source]}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${sourceTone}`}
                >
                  {sourceLabel}
                </span>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${card.statusToneClass}`}
                >
                  {card.statusLabel}
                </span>
              </div>

              <p className="font-numeric text-[15px] font-bold text-on-surface">
                {timeLabel}
              </p>

              <h4 className="font-display text-lg font-bold leading-snug text-on-surface">
                {card.title}
              </h4>

              <CalendarDetailRow label="Address">
                {formatAddress(card.address)}
              </CalendarDetailRow>

              <CalendarDetailRow label="Reference" mono>
                {card.reference}
              </CalendarDetailRow>

              <CalendarDetailRow label="Customer">
                {card.customerName}
              </CalendarDetailRow>

              {assignee ? (
                <CalendarDetailRow label="Assigned to">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container">
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
                      <span className="font-body text-[14px] font-bold text-on-surface">
                        {assignee.name}
                      </span>
                    </div>
                    <span className="w-fit rounded bg-slate-700 px-2 py-0.5 font-body text-[10px] font-semibold uppercase text-white">
                      {assignee.type === "owner" ? "Owner" : "Staff"}
                    </span>
                  </div>
                </CalendarDetailRow>
              ) : null}

              <Link
                href={card.openHref}
                className="inline-flex w-fit font-body text-[14px] font-semibold text-primary hover:underline"
                onClick={onOpenLink}
              >
                Open
              </Link>
            </div>
          </article>
        );
      })}
    </>
  );
}

function calendarEventTitle(event: CalendarEvent): string {
  if (event.booking) return bookingTitle(event.booking);
  if (event.request) return requestTitle(event.request);
  return "—";
}

function eventTimeLabel(card: CalendarCardView, date: string): string {
  if (card.scheduledSlot?.date === date) {
    const window = formatVisitWindow(
      card.scheduledStartTime,
      card.scheduledEndTime,
    );
    if (window) return window;
    return TIME_RANGE_SHORT_LABELS[card.scheduledSlot.timeRange];
  }

  const proposed = card.ownerProposedSlots.find((slot) => slot.date === date);
  if (proposed) return TIME_RANGE_SHORT_LABELS[proposed.timeRange];

  const preferred = card.preferredSlots.find((slot) => slot.date === date);
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
  const {
    bookings,
    loading: bookingsLoading,
    error: bookingsError,
  } = useBookings();
  const { staff, loading: staffLoading } = useBusinessStaffSummary();
  const today = useMemo(() => normalizeDate(new Date()), []);
  const todayIso = useMemo(() => toIsoDateLocal(today), [today]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));
  const [focusDate, setFocusDate] = useState(() => today);
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
    () => buildMonthGridCalendarEvents(requests, filters, bookings),
    [requests, filters, bookings],
  );

  const monthEventsByDate = useMemo(
    () => groupEventsByDate(monthGridEvents),
    [monthGridEvents],
  );

  const stats = useMemo(
    () => computeCombinedCalendarStats(requests, todayIso, filters, bookings),
    [requests, todayIso, filters, bookings],
  );

  const unassignedCount = stats[1]?.value ?? 0;

  const focusIso = useMemo(() => toIsoDateLocal(focusDate), [focusDate]);

  const selectedDayEvents = selectedIsoDate
    ? (monthEventsByDate[selectedIsoDate] ?? [])
    : [];

  const focusDayEvents = monthEventsByDate[focusIso] ?? [];

  const weekDays = useMemo(
    () => weekDaysFromAnchor(focusDate),
    [focusDate],
  );

  const periodLabel = useMemo(() => {
    if (viewTab === "Today") return DAY_FORMAT.format(focusDate);
    if (viewTab === "Week") return formatWeekRange(focusDate);
    return MONTH_FORMAT.format(viewMonth);
  }, [viewTab, focusDate, viewMonth]);

  const navAria = useMemo(() => {
    if (viewTab === "Today") {
      return { prev: "Previous day", next: "Next day" };
    }
    if (viewTab === "Week") {
      return { prev: "Previous week", next: "Next week" };
    }
    return { prev: "Previous month", next: "Next month" };
  }, [viewTab]);

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

  function openDayByIso(isoDate: string) {
    setSelectedIsoDate(isoDate);
    setBookingDrawerOpen(true);
  }

  function openDay(day: number) {
    openDayByIso(isoDateFromParts(viewMonth, day));
  }

  function handleViewTab(tab: (typeof VIEW_TABS)[number]) {
    setViewTab(tab);
    if (tab === "Today") {
      setFocusDate(today);
      setViewMonth(startOfMonth(today));
      return;
    }
    if (tab === "Week") {
      setFocusDate(today);
      setViewMonth(startOfMonth(today));
      return;
    }
    setViewMonth(startOfMonth(focusDate));
  }

  function navigatePeriod(direction: -1 | 1) {
    if (viewTab === "Today") {
      const next = addDays(focusDate, direction);
      setFocusDate(next);
      setViewMonth(startOfMonth(next));
      return;
    }
    if (viewTab === "Week") {
      const next = addDays(focusDate, direction * 7);
      setFocusDate(next);
      setViewMonth(startOfMonth(next));
      return;
    }
    setViewMonth((current) => addMonths(current, direction));
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
              {periodLabel}
            </h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => navigatePeriod(-1)}
                className="rounded-lg p-1 transition-colors hover:bg-surface-container"
                aria-label={navAria.prev}
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                onClick={() => navigatePeriod(1)}
                className="rounded-lg p-1 transition-colors hover:bg-surface-container"
                aria-label={navAria.next}
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

        {viewTab === "Month" ? (
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
              const isTodayCell = isSameDay(cellDate, today);
              const dayEvents = monthEventsByDate[isoDate] ?? [];

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => openDay(day)}
                  className={`group flex min-h-[88px] cursor-pointer flex-col justify-between border-b border-r border-outline-variant p-2 text-left transition-colors hover:bg-surface-container-low active:scale-[0.99] sm:min-h-[120px] sm:p-3 ${
                    isTodayCell ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span
                      className={`font-numeric text-base font-bold sm:text-lg ${
                        isTodayCell
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
        ) : null}

        {viewTab === "Week" ? (
          <>
            {/* Mobile: stacked days — readable on narrow screens */}
            <div className="divide-y divide-outline-variant lg:hidden">
              {weekDays.map((day) => {
                const isoDate = toIsoDateLocal(day);
                const isTodayCell = isSameDay(day, today);
                const dayEvents = monthEventsByDate[isoDate] ?? [];

                return (
                  <div
                    key={`week-mobile-${isoDate}`}
                    className={isTodayCell ? "bg-primary/[0.04]" : ""}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFocusDate(day);
                        openDayByIso(isoDate);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-container-low"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center font-numeric text-base font-bold ${
                            isTodayCell
                              ? "rounded-full bg-primary text-on-primary"
                              : "rounded-full bg-surface-container text-on-surface"
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        <div className="min-w-0">
                          <p className="font-body text-[15px] font-semibold text-on-surface">
                            {WEEKDAY_LONG_FORMAT.format(day)}
                          </p>
                          <p className="font-body text-[12px] text-on-surface-variant">
                            {DAY_FORMAT.format(day)}
                          </p>
                        </div>
                      </div>
                      {dayEvents.length > 0 ? (
                        <span className="shrink-0 rounded-full bg-surface-container-high px-2.5 py-1 font-numeric text-[11px] font-bold text-on-surface-variant">
                          {dayEvents.length}
                        </span>
                      ) : (
                        <span className="font-body text-[12px] text-outline-variant">
                          Free
                        </span>
                      )}
                    </button>
                    {dayEvents.length > 0 ? (
                      <div className="flex flex-col gap-2 px-4 pb-4">
                        {dayEvents.map((event) => (
                          <button
                            key={event.key}
                            type="button"
                            onClick={() => openDayByIso(isoDate)}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left font-body text-[13px] font-semibold leading-snug transition-opacity active:opacity-90 ${
                              event.source === "bookings"
                                ? "border-primary/25 bg-primary/10 text-primary"
                                : "border-green-200 bg-green-50 text-green-800"
                            }`}
                          >
                            {calendarEventTitle(event)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Desktop: 7-column grid */}
            <div className="hidden flex-col lg:flex">
              <div className="grid grid-cols-7 border-b border-outline-variant">
                {weekDays.map((day, index) => {
                  const isoDate = toIsoDateLocal(day);
                  const isTodayCell = isSameDay(day, today);
                  const isFocusDay = isSameDay(day, focusDate);

                  return (
                    <button
                      key={`week-head-${isoDate}`}
                      type="button"
                      onClick={() => {
                        setFocusDate(day);
                        openDayByIso(isoDate);
                      }}
                      className={`flex h-14 items-center justify-between gap-1 border-r border-outline-variant px-2 text-left transition-colors hover:bg-surface-container-low last:border-r-0 sm:px-3 ${
                        isTodayCell ? "bg-primary/5" : "bg-surface-container-low"
                      } ${isFocusDay && !isTodayCell ? "ring-1 ring-inset ring-primary/30" : ""}`}
                    >
                      <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-outline sm:text-[11px]">
                        {WEEKDAY_LABELS[index]}
                      </span>
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center font-numeric text-sm font-bold ${
                          isTodayCell
                            ? "rounded-full bg-primary text-on-primary"
                            : "text-on-surface"
                        }`}
                      >
                        {day.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="grid min-h-[280px] grid-cols-7 auto-rows-fr">
                {weekDays.map((day) => {
                  const isoDate = toIsoDateLocal(day);
                  const dayEvents = monthEventsByDate[isoDate] ?? [];

                  return (
                    <div
                      key={`week-body-${isoDate}`}
                      className="flex flex-col border-r border-outline-variant last:border-r-0"
                    >
                      <div className="flex flex-1 flex-col gap-1.5 p-2">
                        {dayEvents.length === 0 ? (
                          <p className="py-4 text-center font-body text-[11px] text-outline-variant">
                            —
                          </p>
                        ) : (
                          dayEvents.map((event) => (
                            <button
                              key={event.key}
                              type="button"
                              onClick={() => openDayByIso(isoDate)}
                              className={`w-full truncate rounded-lg border px-2 py-1.5 text-left font-body text-[11px] font-semibold transition-opacity hover:opacity-90 ${
                                event.source === "bookings"
                                  ? "border-primary/25 bg-primary/10 text-primary"
                                  : "border-green-200 bg-green-50 text-green-800"
                              }`}
                            >
                              {calendarEventTitle(event)}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {viewTab === "Today" ? (
          <div className="p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="font-body text-[13px] font-semibold text-on-surface-variant">
                {focusDayEvents.length > 0
                  ? `${focusDayEvents.length} ${focusDayEvents.length === 1 ? "item" : "items"} scheduled`
                  : "No visits or bookings on this day"}
              </p>
              {isSameDay(focusDate, today) ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 font-body text-[11px] font-semibold text-primary">
                  Today
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-4">
              <CalendarDayEventCards events={focusDayEvents} />
            </div>
          </div>
        ) : null}
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
              <CalendarDayEventCards
                events={selectedDayEvents}
                onOpenLink={closeBookingDrawer}
              />
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
