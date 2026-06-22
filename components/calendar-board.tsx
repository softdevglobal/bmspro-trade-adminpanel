"use client";

import {
  formatAddress,
  formatClockTime,
  TIME_RANGE_SHORT_LABELS,
  formatVisitWindow,
  isClockTime,
  type InspectionTimeRange,
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
import {
  CALENDAR_SESSION_META,
  calendarEventPlacementsForDay,
  calendarEventHourSlots,
  calendarSlotSelection,
  generateCalendarHourSlots,
  type CalendarHourSlotPlacement,
  type CalendarSlotSelection,
  type CalendarTimeSlot,
} from "@/lib/calendar/time-slots";
import { usePersonalCalendarEvents } from "@/lib/calendar/use-personal-events";
import type { PersonalCalendarEvent } from "@/lib/calendar/personal-events/types";
import { useCalendarFilterOptions } from "@/lib/calendar/use-calendar-filter-options";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { useAuth } from "@/lib/auth/auth-context";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { useCalendarSlotOccupancy } from "@/lib/calendar/use-calendar-slot-occupancy";
import { occupancyForHour } from "@/lib/calendar/slot-occupancy-types";
import type { HourSlotOccupancy } from "@/lib/calendar/slot-occupancy-types";
import { useBusinessClosures } from "@/lib/calendar/use-business-closures";
import type { BusinessClosure } from "@/lib/calendar/business-closures/types";
import { MarkBusinessClosureModal } from "@/components/mark-business-closure-modal";
import { AddInspectionModal } from "@/components/add-inspection-modal";
import { AddPersonalEventModal } from "@/components/add-personal-event-modal";
import {
  CalendarSlotAddMenu,
  type CalendarAddEventKind,
} from "@/components/calendar-slot-add-menu";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  "absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-[512px] flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl transition-transform duration-300 will-change-transform sm:w-full sm:rounded-none sm:border-y-0 sm:border-r-0 sm:border-l";

const CLOSED_DAY_MONTH_CELL_CLASS =
  "bg-amber-100 ring-1 ring-inset ring-amber-300 hover:bg-amber-50";
const CLOSED_DAY_WEEK_SURFACE_CLASS = "bg-amber-50";
const CLOSED_DAY_WEEK_HEADER_CLASS =
  "bg-amber-100 ring-1 ring-inset ring-amber-300/80";

function BusinessOffDayBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`rounded-full bg-amber-200 font-body font-bold uppercase tracking-wide text-amber-950 ${
        compact
          ? "px-1.5 py-0.5 text-[9px]"
          : "px-2 py-0.5 text-[10px]"
      }`}
    >
      Off day
    </span>
  );
}

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

const CALENDAR_HOUR_SLOTS = generateCalendarHourSlots();

const CALENDAR_SESSIONS: {
  session: InspectionTimeRange;
  slots: CalendarTimeSlot[];
}[] = [
  {
    session: "morning",
    slots: CALENDAR_HOUR_SLOTS.filter((slot) => slot.session === "morning"),
  },
  {
    session: "afternoon",
    slots: CALENDAR_HOUR_SLOTS.filter((slot) => slot.session === "afternoon"),
  },
];

function CalendarHourSlotRow({
  slot,
  isoDate,
  placements,
  occupancy,
  capacityLoading,
  canAddEvents,
  closedDay = false,
  onAddEvent,
  onOpenLink,
  onEditPersonalEvent,
}: {
  slot: CalendarTimeSlot;
  isoDate: string;
  placements: CalendarHourSlotPlacement[];
  occupancy?: HourSlotOccupancy;
  capacityLoading: boolean;
  canAddEvents: boolean;
  closedDay?: boolean;
  onAddEvent: (kind: CalendarAddEventKind, selection: CalendarSlotSelection) => void;
  onOpenLink?: () => void;
  onEditPersonalEvent?: (event: PersonalCalendarEvent) => void;
}) {
  const selection = calendarSlotSelection(isoDate, slot);
  const startLabel = formatClockTime(slot.startTime);
  const endLabel = formatClockTime(slot.endTime);
  const timeLabel =
    startLabel && endLabel ? `${startLabel} – ${endLabel}` : slot.startTime;
  const slotFull =
    !capacityLoading && occupancy != null && occupancy.jobsFull && occupancy.requestsFull;

  return (
    <div className="rounded-lg border border-outline-variant/50 bg-surface-container-lowest/80">
      <div className="relative z-10 flex items-center justify-between gap-3 border-b border-outline-variant/40 bg-surface-container-lowest/80 px-3 py-2">
        <div className="min-w-0">
          <p className="font-numeric text-[13px] font-bold text-on-surface">
            {timeLabel}
          </p>
          {occupancy ? (
            <p className="mt-0.5 font-body text-[10px] text-on-surface-variant">
              {occupancy.jobCount}/{occupancy.maxJobs} jobs ·{" "}
              {occupancy.requestCount}/{occupancy.maxRequests} requests
              {slotFull ? (
                <span className="ml-1 font-semibold uppercase text-error">
                  · Full
                </span>
              ) : null}
            </p>
          ) : capacityLoading ? (
            <p className="mt-0.5 font-body text-[10px] text-on-surface-variant">
              Checking capacity…
            </p>
          ) : null}
        </div>
        {canAddEvents ? (
          <CalendarSlotAddMenu
            slot={selection}
            occupancy={occupancy}
            capacityLoading={capacityLoading}
            closedDay={closedDay}
            onSelect={onAddEvent}
          />
        ) : null}
      </div>
      <div className="p-3">
        {placements.length > 0 ? (
          <div className="flex flex-col gap-3">
            <CalendarDayEventCards
              placements={placements}
              onOpenLink={onOpenLink}
              canManageEvents={canAddEvents}
              onEditPersonalEvent={onEditPersonalEvent}
              compact
            />
          </div>
        ) : (
          <p className="font-body text-[12px] text-on-surface-variant">
            Available
          </p>
        )}
      </div>
    </div>
  );
}

function CalendarDayTimeSlots({
  isoDate,
  events,
  canAddEvents,
  isBusinessClosed,
  onAddEvent,
  onOpenLink,
  onEditPersonalEvent,
}: {
  isoDate: string;
  events: CalendarEvent[];
  canAddEvents: boolean;
  isBusinessClosed?: boolean;
  onAddEvent: (kind: CalendarAddEventKind, selection: CalendarSlotSelection) => void;
  onOpenLink?: () => void;
  onEditPersonalEvent?: (event: PersonalCalendarEvent) => void;
}) {
  const occupancyRefreshKey = useMemo(
    () => events.map((event) => event.key).join("|"),
    [events],
  );
  const {
    slots: occupancySlots,
    loading: capacityLoading,
    reload: reloadOccupancy,
  } = useCalendarSlotOccupancy(isoDate, occupancyRefreshKey);

  const placementsByHour = useMemo(
    () => calendarEventPlacementsForDay(events),
    [events],
  );

  const unslottedEvents = useMemo(
    () => events.filter((event) => calendarEventHourSlots(event).length === 0),
    [events],
  );

  function handleAddEvent(
    kind: CalendarAddEventKind,
    selection: CalendarSlotSelection,
  ) {
    if (isBusinessClosed) return;
    const occupancy = occupancyForHour(occupancySlots, selection.startTime);
    if (kind === "job" && occupancy?.jobsFull) return;
    if (kind === "inspection" && occupancy?.requestsFull) return;
    onAddEvent(kind, selection);
    window.setTimeout(() => {
      void reloadOccupancy();
    }, 0);
  }

  return (
    <div className="flex flex-col gap-5">
      {isBusinessClosed ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="font-body text-[13px] font-semibold text-amber-900">
            Business off day
          </p>
          <p className="mt-1 font-body text-[12px] leading-relaxed text-amber-800">
            Jobs, inspection requests, and personal events cannot be added on
            this date. Reactivate the day to schedule again.
          </p>
        </div>
      ) : null}
      {CALENDAR_SESSIONS.map(({ session, slots }) => {
        const meta = CALENDAR_SESSION_META[session];

        return (
          <section
            key={session}
            className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest"
          >
            <div className="flex items-center gap-2.5 border-b border-outline-variant/60 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined material-symbols-filled text-[18px]">
                  {meta.icon}
                </span>
              </span>
              <div className="min-w-0">
                <p className="font-body text-[13px] font-bold text-on-surface">
                  {meta.label}
                </p>
                <p className="font-body text-[11px] text-on-surface-variant">
                  {meta.hint} · 1 hour slots
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 p-3 sm:p-4">
              {slots.map((slot) => (
                <CalendarHourSlotRow
                  key={`${isoDate}-${slot.startTime}`}
                  slot={slot}
                  isoDate={isoDate}
                  placements={placementsByHour[slot.startTime] ?? []}
                  occupancy={occupancyForHour(occupancySlots, slot.startTime)}
                  capacityLoading={capacityLoading}
                  canAddEvents={canAddEvents}
                  closedDay={isBusinessClosed}
                  onAddEvent={handleAddEvent}
                  onOpenLink={onOpenLink}
                  onEditPersonalEvent={onEditPersonalEvent}
                />
              ))}
            </div>
          </section>
        );
      })}

      {unslottedEvents.length > 0 ? (
        <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Other scheduled items
          </p>
          <div className="mt-3 flex flex-col gap-4">
            <CalendarDayEventCards
              events={unslottedEvents}
              onOpenLink={onOpenLink}
              canManageEvents={canAddEvents}
              onEditPersonalEvent={onEditPersonalEvent}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
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
  placements,
  onOpenLink,
  compact = false,
  canManageEvents = false,
  onEditPersonalEvent,
}: {
  events?: CalendarEvent[];
  placements?: CalendarHourSlotPlacement[];
  onOpenLink?: () => void;
  compact?: boolean;
  canManageEvents?: boolean;
  onEditPersonalEvent?: (event: PersonalCalendarEvent) => void;
}) {
  const rows: CalendarHourSlotPlacement[] =
    placements ??
    events?.map((event) => ({ event, continued: false })) ??
    [];

  if (rows.length === 0) {
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
      {rows.map(({ event, continued }) => {
        if (event.personalEvent) {
          const personal = event.personalEvent;
          const timeLabel = eventTimeLabel(event, null, event.date);

          return (
            <article
              key={`${event.key}-${continued ? "continued" : "start"}`}
              className={`${CALENDAR_SOURCE_CARD_CLASS.personal}${compact ? " !p-3" : ""}${continued ? " border-l-4 border-l-violet-500/50" : ""}`}
            >
              <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {continued ? (
                      <span className="inline-flex w-fit items-center rounded-full border border-outline-variant bg-surface-container px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
                        Continued
                      </span>
                    ) : null}
                    <span className="inline-flex w-fit items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-violet-800">
                      Personal
                    </span>
                  </div>
                  <p
                    className={`shrink-0 text-right font-numeric font-bold leading-snug text-on-surface ${
                      compact ? "text-[12px]" : "text-[14px]"
                    }`}
                  >
                    {timeLabel}
                  </p>
                </div>
                {!continued ? (
                  <h4
                    className={`font-display font-bold leading-snug text-on-surface ${
                      compact ? "text-[15px]" : "text-lg"
                    }`}
                  >
                    {personal.title}
                  </h4>
                ) : (
                  <p className="font-body text-[13px] font-semibold text-on-surface">
                    {personal.title}
                  </p>
                )}
                {personal.notes ? (
                  <p className="font-body text-[12px] text-on-surface-variant">
                    {personal.notes}
                  </p>
                ) : null}
                {canManageEvents && !continued && onEditPersonalEvent ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onEditPersonalEvent(personal)}
                      className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/60 bg-white px-2.5 py-1.5 font-body text-[12px] font-semibold text-on-surface transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        edit
                      </span>
                      Edit
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        }

        const card = calendarCardView(event);
        if (!card) return null;

        const timeLabel = eventTimeLabel(event, card, event.date);
        const assignee = card.assignedTo;
        const sourceLabel = CALENDAR_SOURCE_LABELS[event.source];
        const sourceTone =
          event.source === "jobs"
            ? "bg-primary/10 text-primary border border-primary/25"
            : event.source === "personal"
              ? "bg-violet-50 text-violet-800 border border-violet-200"
              : "bg-green-50 text-green-700 border border-green-200";

        return (
          <Link
            key={`${event.key}-${continued ? "continued" : "start"}`}
            href={card.openHref}
            onClick={onOpenLink}
            className={`block transition-colors hover:opacity-95 ${CALENDAR_SOURCE_CARD_CLASS[event.source]}${compact ? " !p-3" : ""}${continued ? " border-l-4 border-l-primary/50" : ""}`}
          >
            <div className={`flex flex-col ${compact ? "gap-2" : "gap-3"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap gap-2">
                  {continued ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-outline-variant bg-surface-container px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
                      Continued
                    </span>
                  ) : null}
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
                <p
                  className={`shrink-0 text-right font-numeric font-bold leading-snug text-on-surface ${
                    compact ? "text-[12px]" : "text-[14px]"
                  }`}
                >
                  {timeLabel}
                </p>
              </div>

              {!continued ? (
                <h4
                  className={`font-display font-bold leading-snug text-on-surface ${
                    compact ? "text-[15px]" : "text-lg"
                  }`}
                >
                  {card.title}
                </h4>
              ) : (
                <p className="font-body text-[13px] font-semibold text-on-surface">
                  {card.title}
                </p>
              )}

              {!compact ? (
                <>
                  <CalendarDetailRow label="Address">
                    {formatAddress(card.address)}
                  </CalendarDetailRow>

                  <CalendarDetailRow label="Reference" mono>
                    {card.reference}
                  </CalendarDetailRow>

                  <CalendarDetailRow label="Customer">
                    {card.customerName}
                  </CalendarDetailRow>
                </>
              ) : (
                <p className="font-body text-[12px] text-on-surface-variant">
                  {card.customerName}
                </p>
              )}

              {!compact && assignee ? (
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

              <span
                className={`inline-flex w-fit items-center gap-1 font-body font-semibold text-primary ${
                  compact ? "text-[12px]" : "text-[14px]"
                }`}
              >
                Open
                <span className="material-symbols-outlined text-[16px]">
                  arrow_forward
                </span>
              </span>
            </div>
          </Link>
        );
      })}
    </>
  );
}

function calendarEventTitle(event: CalendarEvent): string {
  if (event.personalEvent) return event.personalEvent.title;
  if (event.booking) return bookingTitle(event.booking);
  if (event.request) return requestTitle(event.request);
  return "—";
}

function eventTimeLabel(
  event: CalendarEvent,
  card: CalendarCardView | null,
  date: string,
): string {
  if (event.personalEvent) {
    return (
      formatVisitWindow(
        event.personalEvent.startTime,
        event.personalEvent.endTime,
      ) ?? "Time TBC"
    );
  }

  if (!card) return "Time TBC";

  const window = formatVisitWindow(
    card.scheduledStartTime,
    card.scheduledEndTime,
  );
  if (window && card.scheduledSlot?.date === date) {
    return window;
  }

  if (card.scheduledSlot?.date === date) {
    if (isClockTime(card.scheduledStartTime)) {
      const start = formatClockTime(card.scheduledStartTime);
      if (start) return start;
    }
    return TIME_RANGE_SHORT_LABELS[card.scheduledSlot.timeRange];
  }

  const proposed = card.ownerProposedSlots.find((slot) => slot.date === date);
  if (proposed) return TIME_RANGE_SHORT_LABELS[proposed.timeRange];

  const preferred = card.preferredSlots.find((slot) => slot.date === date);
  if (preferred) return TIME_RANGE_SHORT_LABELS[preferred.timeRange];

  return "Time TBC";
}

export function CalendarBoard() {
  const router = useRouter();
  const { user, role } = useAuth();
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
  const {
    events: personalEvents,
    reload: reloadPersonalEvents,
  } = usePersonalCalendarEvents();
  const { staff, loading: staffLoading } = useBusinessStaffSummary();
  const today = useMemo(() => normalizeDate(new Date()), []);
  const todayIso = useMemo(() => toIsoDateLocal(today), [today]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));
  const [focusDate, setFocusDate] = useState(() => today);
  const [viewTab, setViewTab] = useState<(typeof VIEW_TABS)[number]>("Month");
  const [bookingDrawerOpen, setBookingDrawerOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  useRegisterRightDrawer(bookingDrawerOpen, "md");
  useRegisterRightDrawer(filterDrawerOpen, "md");
  const [selectedIsoDate, setSelectedIsoDate] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalVariant, setAddModalVariant] = useState<"inspection" | "job">(
    "inspection",
  );
  const [addModalInitialWindow, setAddModalInitialWindow] =
    useState<CalendarSlotSelection | null>(null);
  const [personalEventModalOpen, setPersonalEventModalOpen] = useState(false);
  const [personalEventSlot, setPersonalEventSlot] =
    useState<CalendarSlotSelection | null>(null);
  const [editingPersonalEvent, setEditingPersonalEvent] =
    useState<PersonalCalendarEvent | null>(null);
  const [closureModalOpen, setClosureModalOpen] = useState(false);
  const [closureModalDate, setClosureModalDate] = useState<string | null>(null);
  const [filters, setFilters] = useState<CalendarFilters>(() =>
    emptyCalendarFilters(null),
  );

  const closureRange = useMemo(() => {
    const from = isoDateFromParts(viewMonth, 1);
    const to = isoDateFromParts(viewMonth, daysInMonth(viewMonth));
    return { from, to };
  }, [viewMonth]);

  const {
    closures,
    reload: reloadClosures,
  } = useBusinessClosures(closureRange.from, closureRange.to);

  const closedDates = useMemo(
    () => new Set(closures.map((closure) => closure.date)),
    [closures],
  );

  const selectedDayClosure = useMemo((): BusinessClosure | null => {
    if (!selectedIsoDate) return null;
    return closures.find((closure) => closure.date === selectedIsoDate) ?? null;
  }, [closures, selectedIsoDate]);

  const isSelectedDayClosed = selectedDayClosure != null;

  const closureModalIsoDate = closureModalDate ?? selectedIsoDate ?? "";
  const isClosureModalDayClosed = closureModalIsoDate
    ? closedDates.has(closureModalIsoDate)
    : false;
  const closureModalClosure = useMemo((): BusinessClosure | null => {
    if (!closureModalIsoDate) return null;
    return closures.find((closure) => closure.date === closureModalIsoDate) ?? null;
  }, [closures, closureModalIsoDate]);
  const closureModalDateLabel = closureModalIsoDate
    ? DAY_FORMAT.format(new Date(`${closureModalIsoDate}T12:00:00`))
    : "";

  function openClosureModal(isoDate: string) {
    setClosureModalDate(isoDate);
    setClosureModalOpen(true);
  }

  function closeClosureModal() {
    setClosureModalOpen(false);
    setClosureModalDate(null);
  }

  const canAddEvents = role === "business_owner";

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
    () =>
      buildMonthGridCalendarEvents(
        requests,
        filters,
        bookings,
        personalEvents,
      ),
    [requests, filters, bookings, personalEvents],
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

  function openAddEvent(
    kind: CalendarAddEventKind,
    selection: CalendarSlotSelection,
  ) {
    if (closedDates.has(selection.date)) {
      return;
    }

    if (kind === "personal") {
      setEditingPersonalEvent(null);
      setPersonalEventSlot(selection);
      setPersonalEventModalOpen(true);
      return;
    }

    setAddModalVariant(kind === "job" ? "job" : "inspection");
    setAddModalInitialWindow(selection);
    setAddModalOpen(true);
  }

  function closeAddModal() {
    setAddModalOpen(false);
    setAddModalInitialWindow(null);
    setAddModalVariant("inspection");
  }

  function closePersonalEventModal() {
    setPersonalEventModalOpen(false);
    setPersonalEventSlot(null);
    setEditingPersonalEvent(null);
  }

  function openEditPersonalEvent(event: PersonalCalendarEvent) {
    setEditingPersonalEvent(event);
    setPersonalEventSlot(null);
    setPersonalEventModalOpen(true);
  }

  function openCalendarEvent(event: CalendarEvent, isoDate: string) {
    if (event.personalEvent) {
      openEditPersonalEvent(event.personalEvent);
      return;
    }

    const card = calendarCardView(event);
    if (card) {
      closeBookingDrawer();
      router.push(card.openHref);
      return;
    }

    openDayByIso(isoDate);
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
            No requests yet
          </p>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            Requests from your booking page and owner-created visits will appear
            on the calendar.
          </p>
          <Link
            href="/dashboard/requests"
            className="mt-3 inline-flex items-center gap-1 font-body text-[13px] font-semibold text-primary hover:underline"
          >
            Go to Requests
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
              { color: "bg-primary", label: "Jobs" },
              { color: "bg-sky-500", label: "Completed" },
              { color: "bg-green-500", label: "Requests" },
              { color: "bg-violet-500", label: "Personal" },
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
              const isClosedDay = closedDates.has(isoDate);

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => openDay(day)}
                  className={`group flex min-h-[88px] cursor-pointer flex-col justify-between border-b border-r border-outline-variant p-2 text-left transition-colors hover:bg-surface-container-low active:scale-[0.99] sm:min-h-[120px] sm:p-3 ${
                    isClosedDay
                      ? isTodayCell
                        ? `${CLOSED_DAY_MONTH_CELL_CLASS} ring-2 ring-amber-400`
                        : CLOSED_DAY_MONTH_CELL_CLASS
                      : isTodayCell
                        ? "bg-primary/5"
                        : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span
                      className={`font-numeric text-base font-bold sm:text-lg ${
                        isTodayCell
                          ? `flex h-8 w-8 items-center justify-center rounded-full ${
                              isClosedDay
                                ? "bg-amber-600 text-white"
                                : "bg-primary text-on-primary"
                            }`
                          : isClosedDay
                            ? "text-amber-900"
                            : "text-on-surface"
                      }`}
                    >
                      {day}
                    </span>
                    <div className="flex flex-col items-end gap-1">
                      {isClosedDay ? <BusinessOffDayBadge compact /> : null}
                      {dayEvents.length > 0 ? (
                        <span className="font-numeric text-[10px] font-bold text-outline-variant group-hover:text-primary">
                          {dayEvents.length}{" "}
                          {dayEvents.length === 1 ? "item" : "items"}
                        </span>
                      ) : null}
                    </div>
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
                const isClosedDay = closedDates.has(isoDate);
                const dayEvents = monthEventsByDate[isoDate] ?? [];

                return (
                  <div
                    key={`week-mobile-${isoDate}`}
                    className={
                      isClosedDay
                        ? CLOSED_DAY_WEEK_SURFACE_CLASS
                        : isTodayCell
                          ? "bg-primary/[0.04]"
                          : ""
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFocusDate(day);
                        openDayByIso(isoDate);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-surface-container-low ${
                        isClosedDay ? "active:bg-amber-100" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center font-numeric text-base font-bold ${
                            isTodayCell
                              ? `rounded-full ${
                                  isClosedDay
                                    ? "bg-amber-600 text-white"
                                    : "bg-primary text-on-primary"
                                }`
                              : isClosedDay
                                ? "rounded-full bg-amber-200 text-amber-950"
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
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {isClosedDay ? <BusinessOffDayBadge /> : null}
                        {dayEvents.length > 0 ? (
                          <span className="rounded-full bg-surface-container-high px-2.5 py-1 font-numeric text-[11px] font-bold text-on-surface-variant">
                            {dayEvents.length}
                          </span>
                        ) : !isClosedDay ? (
                          <span className="font-body text-[12px] text-outline-variant">
                            Free
                          </span>
                        ) : null}
                      </div>
                    </button>
                    {dayEvents.length > 0 ? (
                      <div className="flex flex-col gap-2 px-4 pb-4">
                        {dayEvents.map((event) => (
                          <button
                            key={event.key}
                            type="button"
                            onClick={() => openCalendarEvent(event, isoDate)}
                            className={`w-full rounded-xl border px-3 py-2.5 text-left font-body text-[13px] font-semibold leading-snug transition-opacity active:opacity-90 ${
                              event.source === "jobs"
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
                  const isClosedDay = closedDates.has(isoDate);

                  return (
                    <button
                      key={`week-head-${isoDate}`}
                      type="button"
                      onClick={() => {
                        setFocusDate(day);
                        openDayByIso(isoDate);
                      }}
                      className={`flex h-14 items-center justify-between gap-1 border-r border-outline-variant px-2 text-left transition-colors hover:bg-surface-container-low last:border-r-0 sm:px-3 ${
                        isClosedDay
                          ? CLOSED_DAY_WEEK_HEADER_CLASS
                          : isTodayCell
                            ? "bg-primary/5"
                            : "bg-surface-container-low"
                      } ${isFocusDay && !isTodayCell && !isClosedDay ? "ring-1 ring-inset ring-primary/30" : ""}`}
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-outline sm:text-[11px]">
                          {WEEKDAY_LABELS[index]}
                        </span>
                        {isClosedDay ? <BusinessOffDayBadge compact /> : null}
                      </div>
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center font-numeric text-sm font-bold ${
                          isTodayCell
                            ? `rounded-full ${
                                isClosedDay
                                  ? "bg-amber-600 text-white"
                                  : "bg-primary text-on-primary"
                              }`
                            : isClosedDay
                              ? "rounded-full bg-amber-200 text-amber-950"
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
                  const isClosedDay = closedDates.has(isoDate);
                  const dayEvents = monthEventsByDate[isoDate] ?? [];

                  return (
                    <div
                      key={`week-body-${isoDate}`}
                      className={`flex flex-col border-r border-outline-variant last:border-r-0 ${
                        isClosedDay ? CLOSED_DAY_WEEK_SURFACE_CLASS : ""
                      }`}
                    >
                      <div className="flex flex-1 flex-col gap-1.5 p-2">
                        {isClosedDay ? (
                          <p className="py-2 text-center font-body text-[11px] font-semibold text-amber-900">
                            Off day
                          </p>
                        ) : null}
                        {dayEvents.length === 0 ? (
                          !isClosedDay ? (
                            <p className="py-4 text-center font-body text-[11px] text-outline-variant">
                              —
                            </p>
                          ) : null
                        ) : (
                          dayEvents.map((event) => (
                            <button
                              key={event.key}
                              type="button"
                              onClick={() => openCalendarEvent(event, isoDate)}
                              className={`w-full truncate rounded-lg border px-2 py-1.5 text-left font-body text-[11px] font-semibold transition-opacity hover:opacity-90 ${
                                event.source === "jobs"
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
            {closedDates.has(focusIso) ? (
              <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <BusinessOffDayBadge />
                    <p className="font-body text-[13px] font-semibold text-amber-950">
                      Business off day
                    </p>
                  </div>
                  <p className="mt-1 font-body text-[12px] leading-relaxed text-amber-900">
                    Customers cannot book this date. You can reactivate it when
                    you are open again.
                  </p>
                </div>
                {canAddEvents ? (
                  <button
                    type="button"
                    onClick={() => openClosureModal(focusIso)}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-body text-[12px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      event_available
                    </span>
                    Reactivate day
                  </button>
                ) : null}
              </div>
            ) : canAddEvents ? (
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => openClosureModal(focusIso)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12px] font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    event_busy
                  </span>
                  Mark as off day
                </button>
              </div>
            ) : null}
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="font-body text-[13px] font-semibold text-on-surface-variant">
                {focusDayEvents.length > 0
                  ? `${focusDayEvents.length} ${focusDayEvents.length === 1 ? "item" : "items"} scheduled`
                  : "Hourly schedule · 8am to 5pm"}
              </p>
              {isSameDay(focusDate, today) ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 font-body text-[11px] font-semibold text-primary">
                  Today
                </span>
              ) : null}
            </div>
            <CalendarDayTimeSlots
              isoDate={focusIso}
              events={focusDayEvents}
              canAddEvents={canAddEvents}
              isBusinessClosed={closedDates.has(focusIso)}
              onAddEvent={openAddEvent}
              onEditPersonalEvent={openEditPersonalEvent}
            />
          </div>
        ) : null}
      </section>

      {/* Job drawer */}
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
          <div
            className={`flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant p-5 ${
              isSelectedDayClosed ? "bg-amber-50" : ""
            }`}
          >
            <div className="min-w-0">
              <h3 className="font-display text-headline-sm font-bold text-on-surface">
                {selectedDate ? DAY_FORMAT.format(selectedDate) : "Calendar"}
              </h3>
              <p className="font-body text-[13px] font-semibold text-on-surface-variant">
                {isSelectedDayClosed
                  ? "Business off day"
                  : selectedDayEvents.length > 0
                    ? `${selectedDayEvents.length} ${selectedDayEvents.length === 1 ? "item" : "items"} on this day`
                    : "Nothing scheduled on this day"}
              </p>
              {canAddEvents && selectedIsoDate ? (
                <button
                  type="button"
                  onClick={() => openClosureModal(selectedIsoDate)}
                  className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 font-body text-[12px] font-semibold transition-colors ${
                    isSelectedDayClosed
                      ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
                      : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {isSelectedDayClosed ? "event_available" : "event_busy"}
                  </span>
                  {isSelectedDayClosed ? "Reactivate day" : "Mark as off day"}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeBookingDrawer}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-container"
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 p-5">
              <CalendarDayTimeSlots
                isoDate={selectedIsoDate ?? ""}
                events={selectedDayEvents}
                canAddEvents={canAddEvents}
                isBusinessClosed={isSelectedDayClosed}
                onAddEvent={openAddEvent}
                onOpenLink={closeBookingDrawer}
                onEditPersonalEvent={openEditPersonalEvent}
              />
            </div>
          </div>
        </aside>
      </div>

      <MarkBusinessClosureModal
        open={closureModalOpen}
        date={closureModalIsoDate}
        dateLabel={closureModalDateLabel}
        isClosed={isClosureModalDayClosed}
        closure={closureModalClosure}
        onClose={closeClosureModal}
        onChanged={() => {
          void reloadClosures();
        }}
      />

      <AddInspectionModal
        open={addModalOpen}
        onClose={closeAddModal}
        variant={addModalVariant}
        initialCalendarWindow={addModalInitialWindow}
        onCreated={(jobId) => {
          closeAddModal();
          if (jobId && addModalVariant === "job") {
            router.push(`/dashboard/jobs?job=${encodeURIComponent(jobId)}`);
          }
        }}
      />

      <AddPersonalEventModal
        open={personalEventModalOpen}
        onClose={closePersonalEventModal}
        initialSlot={personalEventSlot}
        editEvent={editingPersonalEvent}
        onSaved={() => {
          void reloadPersonalEvents();
        }}
      />

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
                Job status
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
