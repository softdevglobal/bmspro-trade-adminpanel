"use client";

import {
  formatInPlatformTimeZone,
  formatIsoDateInPlatformTimeZone,
  platformTodayIso,
} from "@/lib/platform/timezone";
import { useEffect, useMemo, useRef, useState } from "react";

export const SLOT_DAYS_PER_PAGE_MOBILE = 3;
/** @deprecated Use SLOT_DAYS_PER_PAGE_MOBILE — mobile always shows 3 days with arrows. */
export const SLOT_DAYS_PER_PAGE_MOBILE_SCROLL = SLOT_DAYS_PER_PAGE_MOBILE;

export type SlotDayStripLayout = "scroll" | "fit";

function useIsMobileViewport(breakpoint = 640): boolean {
  const read = () =>
    typeof window !== "undefined" && window.innerWidth < breakpoint;
  const [mobile, setMobile] = useState(read);
  useEffect(() => {
    const onResize = () => setMobile(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return mobile;
}

/** Days per page depends on layout: customer booking scroll strip vs admin drawer fit. */
function useSlotDaysPerPage(layout: SlotDayStripLayout): number {
  const read = () => {
    if (typeof window === "undefined") return SLOT_DAYS_PER_PAGE;
    if (window.innerWidth < 640) return SLOT_DAYS_PER_PAGE_MOBILE;
    return SLOT_DAYS_PER_PAGE;
  };
  const [count, setCount] = useState(read);
  useEffect(() => {
    const onResize = () => setCount(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [layout]);
  return count;
}

function dayPageIndexForIso(
  iso: string,
  pageSize: number,
  minDate: string,
): number {
  const min = new Date(`${minDate}T12:00:00`);
  const target = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(min.getTime()) || Number.isNaN(target.getTime())) return 0;
  const diffDays = Math.max(
    0,
    Math.round((target.getTime() - min.getTime()) / 86_400_000),
  );
  return Math.min(
    SLOT_MAX_DAY_PAGES - 1,
    Math.floor(diffDays / pageSize),
  );
}

export const SLOT_DAYS_PER_PAGE = 8;
export const SLOT_MAX_DAY_PAGES = 8;

export type SlotCombo = { date: string; timeRange: string };

export function slotComboKey(date: string, timeRange: string): string {
  return `${date}-${timeRange}`;
}

export function buildBlockedComboSet(slots: SlotCombo[]): Set<string> {
  const set = new Set<string>();
  for (const slot of slots) {
    if (slot.date) set.add(slotComboKey(slot.date, slot.timeRange));
  }
  return set;
}

/** True when both morning and afternoon are blocked for this date. */
export function isDayFullyBlocked(
  iso: string,
  blockedCombos: Set<string>,
): boolean {
  return (
    blockedCombos.has(slotComboKey(iso, "morning")) &&
    blockedCombos.has(slotComboKey(iso, "afternoon"))
  );
}

export type SlotDayOption = {
  iso: string;
  weekdayShort: string;
  dayNum: number;
  monthShort: string;
  isToday: boolean;
  isTomorrow: boolean;
};

export function formatLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(timeZone?: string | null): string {
  return platformTodayIso(new Date(), timeZone);
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return formatLocalDateInput(date);
}

function atLocalNoon(date: Date): Date {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  return next;
}

function firstBookableDay(from = new Date()): Date {
  return atLocalNoon(from);
}

export function buildSlotDayOption(
  date: Date,
  timeZone?: string | null,
): SlotDayOption {
  const iso = formatLocalDateInput(date);
  const today = todayIso(timeZone);
  const tomorrow = addDaysIso(today, 1);

  return {
    iso,
    weekdayShort: formatIsoDateInPlatformTimeZone(
      iso,
      { weekday: "short" },
      timeZone,
    ),
    dayNum: date.getDate(),
    monthShort: formatIsoDateInPlatformTimeZone(
      iso,
      { month: "short" },
      timeZone,
    ),
    isToday: iso === today,
    isTomorrow: iso === tomorrow,
  };
}

/** First day on page 0; later pages continue from there (used as booking min date). */
export function getSlotDayPage(
  pageIndex: number,
  pageSize: number,
  anchorDate?: string,
  timeZone?: string | null,
): SlotDayOption[] {
  const anchor = anchorDate?.trim() || todayIso(timeZone);
  const parsed = new Date(`${anchor}T12:00:00`);
  const cursor = Number.isNaN(parsed.getTime())
    ? firstBookableDay()
    : atLocalNoon(parsed);
  const toSkip = pageIndex * pageSize;

  for (let i = 0; i < toSkip; i += 1) {
    cursor.setDate(cursor.getDate() + 1);
  }

  const options: SlotDayOption[] = [];
  for (let i = 0; i < pageSize; i += 1) {
    options.push(buildSlotDayOption(cursor, timeZone));
    cursor.setDate(cursor.getDate() + 1);
  }

  return options;
}

function dayOptionFromIso(
  iso: string,
  timeZone?: string | null,
): SlotDayOption | null {
  if (!iso) return null;
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return buildSlotDayOption(parsed, timeZone);
}

function isBeforeMinDate(iso: string, minDate: string): boolean {
  return iso < minDate;
}

function monthStartMondayOffset(year: number, month: number): number {
  const first = new Date(year, month, 1);
  return (first.getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function BookingMonthCalendar({
  selectedIso = "",
  selectedIsos,
  mode = "single",
  maxSelections = 3,
  minDate,
  onSelect,
  onToggle,
  blockedCombos,
  blockedDayHint = "Customer already offered both morning and afternoon on this day",
  className = "",
  timeZone,
}: {
  selectedIso?: string;
  selectedIsos?: string[];
  mode?: "single" | "multiple";
  maxSelections?: number;
  minDate: string;
  onSelect?: (iso: string) => void;
  onToggle?: (iso: string) => void;
  /** Date+time combos that cannot be chosen (e.g. customer's original picks). */
  blockedCombos?: Set<string>;
  blockedDayHint?: string;
  className?: string;
  timeZone?: string | null;
}) {
  const initialView = selectedIso
    ? new Date(`${selectedIso}T12:00:00`)
    : atLocalNoon(new Date());
  const [viewYear, setViewYear] = useState(initialView.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialView.getMonth());

  const today = todayIso(timeZone);
  const monthLabel = formatInPlatformTimeZone(
    new Date(viewYear, viewMonth, 1, 12, 0, 0, 0),
    { month: "long", year: "numeric" },
    timeZone,
  );

  const minView = useMemo(() => {
    const parsed = new Date(`${minDate}T12:00:00`);
    return { year: parsed.getFullYear(), month: parsed.getMonth() };
  }, [minDate]);

  const canGoPrev =
    viewYear > minView.year ||
    (viewYear === minView.year && viewMonth > minView.month);

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  const gridCells = useMemo(() => {
    const offset = monthStartMondayOffset(viewYear, viewMonth);
    const totalDays = daysInMonth(viewYear, viewMonth);
    const cells: Array<{ iso: string; dayNum: number } | null> = [];

    for (let i = 0; i < offset; i += 1) cells.push(null);
    for (let day = 1; day <= totalDays; day += 1) {
      const date = new Date(viewYear, viewMonth, day, 12, 0, 0, 0);
      cells.push({ iso: formatLocalDateInput(date), dayNum: day });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div
      className={`mt-2 w-full max-w-[17.5rem] rounded-xl border border-stone-200 bg-white p-3 shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          disabled={!canGoPrev}
          onClick={(event) => {
            event.stopPropagation();
            shiftMonth(-1);
          }}
          aria-label="Previous month"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-200 text-on-surface-variant transition-colors enabled:hover:border-primary/40 enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span className="material-symbols-outlined text-[16px]">
            chevron_left
          </span>
        </button>
        <p className="truncate font-body text-[12px] font-bold text-on-surface">
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            shiftMonth(1);
          }}
          aria-label="Next month"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-200 text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
        >
          <span className="material-symbols-outlined text-[16px]">
            chevron_right
          </span>
        </button>
      </div>

      <div className="mt-1.5 grid grid-cols-7 gap-px">
        {weekdayLabels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="flex h-5 items-center justify-center font-body text-[9px] font-bold text-on-surface-variant"
          >
            {label}
          </span>
        ))}
        {gridCells.map((cell, index) => {
          if (!cell) {
            return (
              <span key={`empty-${index}`} className="h-8" aria-hidden />
            );
          }

          const past = isBeforeMinDate(cell.iso, minDate);
          const comboBlocked =
            blockedCombos && isDayFullyBlocked(cell.iso, blockedCombos);
          const disabled = past || comboBlocked;
          const selected =
            mode === "multiple"
              ? (selectedIsos ?? []).includes(cell.iso)
              : selectedIso === cell.iso;
          const atMax =
            mode === "multiple" &&
            !selected &&
            (selectedIsos?.length ?? 0) >= maxSelections;
          const isToday = cell.iso === today;

          return (
            <button
              key={cell.iso}
              type="button"
              disabled={disabled || atMax}
              title={
                comboBlocked
                  ? blockedDayHint
                  : past
                    ? "Choose the inspection day or later"
                    : undefined
              }
              onClick={() => {
                if (mode === "multiple") {
                  onToggle?.(cell.iso);
                  return;
                }
                onSelect?.(cell.iso);
              }}
              className={`flex h-8 w-full items-center justify-center rounded-md font-body text-[12px] font-semibold leading-none transition-colors ${
                disabled
                  ? "cursor-not-allowed text-stone-300"
                  : selected
                    ? "bg-primary text-on-primary"
                    : isToday
                      ? "bg-primary/12 text-primary ring-1 ring-primary/25"
                      : "text-on-surface hover:bg-stone-100"
              }`}
            >
              {cell.dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Horizontal day strip + optional month calendar (same UX as customer booking). */
export function SlotDayPicker({
  selectedIso = "",
  selectedIsos,
  mode = "single",
  maxSelections = 3,
  minDate,
  dayPage,
  onDayPageChange,
  onSelect,
  onToggle,
  disabled = false,
  label = "Pick a day",
  blockedCombos,
  blockedDayHint = "Customer already offered both morning and afternoon on this day",
  /** Customer booking: horizontal scroll strip. Admin propose dates: fit row, no scroll. */
  dayStripLayout = "scroll",
  timeZone,
}: {
  selectedIso?: string;
  selectedIsos?: string[];
  mode?: "single" | "multiple";
  maxSelections?: number;
  minDate: string;
  dayPage: number;
  onDayPageChange: (page: number) => void;
  onSelect?: (iso: string) => void;
  onToggle?: (iso: string) => void;
  disabled?: boolean;
  label?: string;
  blockedCombos?: Set<string>;
  blockedDayHint?: string;
  dayStripLayout?: SlotDayStripLayout;
  timeZone?: string | null;
}) {
  const [showMonthCalendar, setShowMonthCalendar] = useState(false);
  const isMobile = useIsMobileViewport();
  const daysPerPage = useSlotDaysPerPage(dayStripLayout);
  const fitStrip = dayStripLayout === "fit" || isMobile;

  const pageDays = useMemo(
    () => getSlotDayPage(dayPage, daysPerPage, minDate, timeZone),
    [dayPage, daysPerPage, minDate, timeZone],
  );

  const offPageSelections = useMemo(() => {
    if (mode === "multiple") {
      const onPage = new Set(pageDays.map((day) => day.iso));
      return (selectedIsos ?? [])
        .filter((iso) => !onPage.has(iso))
        .map((iso) => dayOptionFromIso(iso, timeZone))
        .filter((day): day is SlotDayOption => day !== null);
    }
    if (!selectedIso || pageDays.some((day) => day.iso === selectedIso)) {
      return [];
    }
    const option = dayOptionFromIso(selectedIso, timeZone);
    return option ? [option] : [];
  }, [mode, selectedIso, selectedIsos, pageDays, timeZone]);

  const displayDays = useMemo(() => {
    if (offPageSelections.length === 0) return pageDays;
    const offPageIsos = new Set(offPageSelections.map((day) => day.iso));
    return [
      ...offPageSelections,
      ...pageDays.filter((day) => !offPageIsos.has(day.iso)),
    ].slice(0, daysPerPage);
  }, [offPageSelections, pageDays, daysPerPage]);

  // Only jump the strip when the user picks a new date — not when they page with arrows.
  const prevSelectedIsoRef = useRef<string | null>(null);
  const prevSelectedIsosRef = useRef<string[]>([]);
  useEffect(() => {
    if (mode === "multiple") {
      const prev = new Set(prevSelectedIsosRef.current);
      const added = (selectedIsos ?? []).find((iso) => !prev.has(iso));
      prevSelectedIsosRef.current = selectedIsos ?? [];
      if (added) {
        onDayPageChange(dayPageIndexForIso(added, daysPerPage, minDate));
      }
      return;
    }
    if (!selectedIso) {
      prevSelectedIsoRef.current = null;
      return;
    }
    if (prevSelectedIsoRef.current === selectedIso) return;
    prevSelectedIsoRef.current = selectedIso;
    onDayPageChange(dayPageIndexForIso(selectedIso, daysPerPage, minDate));
  }, [mode, selectedIso, selectedIsos, daysPerPage, minDate, onDayPageChange]);

  const dayButtons = displayDays.map((day) => {
    const selected =
      mode === "multiple"
        ? (selectedIsos ?? []).includes(day.iso)
        : selectedIso === day.iso;
    const atMax =
      mode === "multiple" &&
      !selected &&
      (selectedIsos?.length ?? 0) >= maxSelections;
    const dayBlocked =
      blockedCombos && isDayFullyBlocked(day.iso, blockedCombos);
    const tooEarly = isBeforeMinDate(day.iso, minDate);
    const relativeLabel = day.isToday
      ? "Today"
      : day.isTomorrow
        ? "Tomorrow"
        : null;
    return (
      <button
        key={day.iso}
        type="button"
        disabled={disabled || dayBlocked || tooEarly || atMax}
        title={
          atMax
            ? "You can pick up to 3 days — tap a selected day to remove it"
            : dayBlocked
              ? blockedDayHint
              : tooEarly
                ? "Choose the inspection day or later"
                : undefined
        }
        onClick={() => {
          if (mode === "multiple") {
            onToggle?.(day.iso);
            return;
          }
          onSelect?.(day.iso);
        }}
        className={`flex min-h-[5.5rem] flex-col items-center justify-between rounded-2xl border py-2 text-center transition-all disabled:cursor-not-allowed ${
          fitStrip
            ? "min-w-0 flex-1 px-1.5 sm:px-2"
            : "min-w-[4.5rem] shrink-0 px-2"
        } ${
          dayBlocked
            ? "border-stone-100 bg-stone-50 opacity-40"
            : selected
              ? "border-primary bg-gradient-to-b from-primary/15 to-primary/5 shadow-[0_8px_20px_-12px_rgba(67,123,255,0.65)] ring-2 ring-primary/25"
              : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
        }`}
      >
        <span
          className={`font-body text-[10px] font-bold uppercase tracking-wide ${
            selected ? "text-primary" : "text-on-surface-variant"
          }`}
        >
          {day.weekdayShort}
        </span>
        <span
          className={`font-display font-semibold leading-none ${
            fitStrip ? "text-[18px] sm:text-[22px]" : "text-[22px]"
          } ${selected ? "text-primary" : "text-on-surface"}`}
        >
          {day.dayNum}
        </span>
        <span
          className={`font-body text-[10px] font-semibold ${
            selected ? "text-primary/80" : "text-on-surface-variant"
          }`}
        >
          {day.monthShort}
        </span>
        <span className="flex h-4 items-center justify-center">
          {selected ? (
            <span className="material-symbols-outlined material-symbols-filled translate-y-px text-[14px] leading-none text-primary">
              check_circle
            </span>
          ) : relativeLabel ? (
            <span
              className={`font-body text-[9px] font-bold ${
                day.isToday ? "text-primary" : "text-stone-600"
              }`}
            >
              {relativeLabel}
            </span>
          ) : null}
        </span>
      </button>
    );
  });

  return (
    <div>
      <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>

      <div
        className={
          fitStrip
            ? "mt-2 flex w-full items-stretch gap-1.5"
            : "mt-2 flex max-w-full items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]"
        }
      >
        <button
          type="button"
          disabled={disabled || dayPage === 0}
          onClick={(event) => {
            event.stopPropagation();
            onDayPageChange(Math.max(0, dayPage - 1));
          }}
          aria-label="Show earlier dates"
          className={`inline-flex h-auto min-h-[5.5rem] w-8 shrink-0 items-center justify-center rounded-full border border-stone-200 text-on-surface-variant transition-colors enabled:hover:border-primary/40 enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${
            fitStrip ? "self-stretch" : "self-center"
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            chevron_left
          </span>
        </button>

        {fitStrip ? (
          <div className="flex min-w-0 flex-1 items-stretch gap-1">
            {dayButtons}
          </div>
        ) : (
          dayButtons
        )}

        <button
          type="button"
          disabled={disabled || dayPage >= SLOT_MAX_DAY_PAGES - 1}
          onClick={(event) => {
            event.stopPropagation();
            onDayPageChange(Math.min(SLOT_MAX_DAY_PAGES - 1, dayPage + 1));
          }}
          aria-label="Show later dates"
          className={`inline-flex h-auto min-h-[5.5rem] w-8 shrink-0 items-center justify-center rounded-full border border-stone-200 text-on-surface-variant transition-colors enabled:hover:border-primary/40 enabled:hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${
            fitStrip ? "self-stretch" : "self-center"
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            chevron_right
          </span>
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setShowMonthCalendar((open) => !open)}
        className="mt-2 inline-flex items-center gap-1 font-body text-[11px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[14px]">
          {showMonthCalendar ? "expand_less" : "calendar_month"}
        </span>
        {showMonthCalendar ? "Hide calendar" : "Browse full calendar"}
      </button>

      {showMonthCalendar ? (
        <BookingMonthCalendar
          selectedIso={selectedIso}
          selectedIsos={selectedIsos}
          mode={mode}
          maxSelections={maxSelections}
          minDate={minDate}
          blockedCombos={blockedCombos}
          blockedDayHint={blockedDayHint}
          timeZone={timeZone}
          onSelect={(iso) => {
            onSelect?.(iso);
            setShowMonthCalendar(false);
          }}
          onToggle={(iso) => {
            onToggle?.(iso);
          }}
        />
      ) : null}
    </div>
  );
}
