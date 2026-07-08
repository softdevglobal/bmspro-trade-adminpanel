"use client";

import {
  SlotDayPicker,
  todayIso,
} from "@/components/booking-slot-date-picker";
import {
  isPastTimeRangeSession,
  PAST_SESSION_HINT,
} from "@/lib/calendar/past-scheduling";
import {
  TIME_RANGE_LABELS,
  formatSlotDate,
  sortInspectionSlots,
  type InspectionSlot,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { useMemo, useState } from "react";

function sortSlots(slots: InspectionSlot[]): InspectionSlot[] {
  return sortInspectionSlots(slots);
}

type JobPreferredDatesPickerProps = {
  value: InspectionSlot[];
  onChange: (slots: InspectionSlot[]) => void;
  timeZone?: string | null;
  disabled?: boolean;
  label?: string;
  /** Shown below the day strip (e.g. customer quote acceptance guidance). */
  helperNote?: string;
  /** Admin flows: allow proposing past job days (customer flows keep the block). */
  allowPast?: boolean;
};

export function JobPreferredDatesPicker({
  value,
  onChange,
  timeZone,
  disabled = false,
  label = "Pick up to 3 preferred job days",
  helperNote,
  allowPast = false,
}: JobPreferredDatesPickerProps) {
  const minDate = todayIso(timeZone);
  const [dayPage, setDayPage] = useState(0);
  const selectedDates = useMemo(
    () => value.map((slot) => slot.date).filter(Boolean),
    [value],
  );
  const maxSelections = 3;

  function toggleDay(iso: string) {
    if (disabled) return;
    const exists = value.some((slot) => slot.date === iso);
    if (exists) {
      onChange(value.filter((slot) => slot.date !== iso));
      return;
    }
    if (value.length >= maxSelections) return;
    onChange(
      sortSlots([
        ...value,
        { date: iso, timeRange: "morning" satisfies InspectionTimeRange },
      ]),
    );
  }

  function updateTimeRange(date: string, timeRange: InspectionTimeRange) {
    onChange(
      value.map((slot) =>
        slot.date === date ? { ...slot, timeRange } : slot,
      ),
    );
  }

  const selectionHint = `${selectedDates.length} of 3 days selected`;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 sm:p-4">
        <SlotDayPicker
          mode="multiple"
          selectedIsos={selectedDates}
          maxSelections={maxSelections}
          minDate={minDate}
          dayPage={dayPage}
          onDayPageChange={setDayPage}
          onToggle={toggleDay}
          label={label}
          dayStripLayout="fit"
          timeZone={timeZone}
          disabled={disabled}
          allowPast={allowPast}
        />
        {helperNote ? (
          <p className="mt-2 rounded-lg border border-amber-200/70 bg-amber-50/90 px-3 py-2 font-body text-[11px] leading-snug text-amber-900/90">
            {helperNote}
          </p>
        ) : null}
        <p className="mt-2 font-body text-[11px] font-semibold text-on-surface-variant">
          {selectionHint}
        </p>
        {selectedDates.length > 0 ? (
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            Tap a selected day again to remove it.
          </p>
        ) : !helperNote ? (
          <p className="mt-2 rounded-xl border border-dashed border-outline-variant/60 bg-white/60 px-3 py-2 font-body text-[12px] text-on-surface-variant">
            Choose at least one day.
          </p>
        ) : null}
      </div>

      {selectedDates.length > 0 ? (
        <ul className="space-y-2">
          {sortSlots(value).map((slot) => (
            <li
              key={slot.date}
              className="rounded-xl border border-stone-200 bg-white p-3"
            >
              <p className="font-body text-[12px] font-bold text-on-surface">
                {formatSlotDate(slot.date, timeZone)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["morning", "afternoon"] as const).map((range) => {
                  const active = slot.timeRange === range;
                  const sessionPast =
                    !allowPast &&
                    isPastTimeRangeSession(slot.date, range, timeZone);
                  return (
                    <button
                      key={range}
                      type="button"
                      disabled={disabled || sessionPast}
                      title={sessionPast ? PAST_SESSION_HINT : undefined}
                      onClick={() => updateTimeRange(slot.date, range)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-body text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-stone-200 bg-stone-50 text-on-surface-variant hover:bg-stone-100"
                      }`}
                    >
                      {TIME_RANGE_LABELS[range]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function isJobPreferredDatesComplete(slots: InspectionSlot[]): boolean {
  return (
    slots.length > 0 &&
    new Set(slots.map((slot) => slot.date)).size === slots.length &&
    slots.every((slot) => slot.date && slot.timeRange)
  );
}
