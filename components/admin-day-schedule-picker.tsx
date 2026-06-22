"use client";

import {
  CalendarVisitTimeRangeFields,
  defaultCalendarVisitEnd,
  validateCalendarVisitWindow,
} from "@/components/calendar-visit-time-range";
import type { HourSlotOccupancy } from "@/lib/calendar/slot-occupancy-types";
import { useAuth } from "@/lib/auth/auth-context";
import { formatClockTime } from "@/lib/inspection/types";
import { parseClockMinutes } from "@/lib/leave/clock";
import { useEffect, useMemo, useState } from "react";

export type AdminScheduleKind = "inspection" | "job";

function overlapsHourBucket(
  startMin: number,
  endMin: number,
  slotStartTime: string,
): boolean {
  const slotStartMin = parseClockMinutes(slotStartTime);
  if (slotStartMin == null) return false;
  return startMin < slotStartMin + 60 && endMin > slotStartMin;
}

function slotStatusLabel(
  slot: HourSlotOccupancy,
  kind: AdminScheduleKind,
): string {
  if (kind === "job") {
    return `${slot.jobCount}/${slot.maxJobs} jobs`;
  }
  return `${slot.requestCount}/${slot.maxRequests} requests`;
}

export function AdminDaySchedulePicker({
  date,
  kind,
  startTime,
  endTime,
  disabled = false,
  onStartTimeChange,
  onEndTimeChange,
}: {
  date: string;
  kind: AdminScheduleKind;
  startTime: string;
  endTime: string;
  disabled?: boolean;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
}) {
  const { user } = useAuth();
  const [slots, setSlots] = useState<HourSlotOccupancy[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBusinessClosed, setIsBusinessClosed] = useState(false);

  useEffect(() => {
    if (!user || !date) {
      setSlots([]);
      setIsBusinessClosed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const token = await user.getIdToken();
        const [occupancyResponse, closureResponse] = await Promise.all([
          fetch(
            `/api/calendar/slot-occupancy?date=${encodeURIComponent(date)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            },
          ),
          fetch(
            `/api/calendar/business-closures?date=${encodeURIComponent(date)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            },
          ),
        ]);
        const occupancyPayload = (await occupancyResponse.json()) as {
          ok?: boolean;
          slots?: HourSlotOccupancy[];
          error?: string;
        };
        const closurePayload = (await closureResponse.json()) as {
          ok?: boolean;
          isClosed?: boolean;
        };

        if (!occupancyResponse.ok || !occupancyPayload.ok || !occupancyPayload.slots) {
          throw new Error(occupancyPayload.error ?? "Could not load time slots.");
        }

        if (!cancelled) {
          setSlots(occupancyPayload.slots);
          setIsBusinessClosed(closurePayload.isClosed === true);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load time slots.",
          );
          setSlots([]);
          setIsBusinessClosed(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, date]);

  const pickerDisabled = disabled || isBusinessClosed;

  const rangeError = useMemo(() => {
    const windowError = validateCalendarVisitWindow(startTime, endTime);
    if (windowError) return windowError;
    if (slots.length === 0) return null;

    const startMin = parseClockMinutes(startTime);
    const endMin = parseClockMinutes(endTime);
    if (startMin == null || endMin == null) return null;

    for (const slot of slots) {
      if (!overlapsHourBucket(startMin, endMin, slot.startTime)) continue;
      const full = kind === "job" ? slot.jobsFull : slot.requestsFull;
      if (full) {
        const label = formatClockTime(slot.startTime);
        return kind === "job"
          ? `The ${label} slot is full for jobs. Choose another time or update capacity in Settings.`
          : `The ${label} slot is full for inspection requests. Choose another time or update capacity in Settings.`;
      }
    }
    return null;
  }, [startTime, endTime, slots, kind]);

  const selectedHours = useMemo(() => {
    const startMin = parseClockMinutes(startTime);
    const endMin = parseClockMinutes(endTime);
    if (startMin == null || endMin == null) return new Set<string>();
    const selected = new Set<string>();
    for (const slot of slots) {
      const slotStartMin = parseClockMinutes(slot.startTime);
      if (slotStartMin == null) continue;
      if (overlapsHourBucket(startMin, endMin, slot.startTime)) {
        selected.add(slot.startTime);
      }
    }
    return selected;
  }, [startTime, endTime, slots]);

  return (
    <div className="space-y-3">
      {isBusinessClosed ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12px] text-amber-900">
          This date is marked as a business off day. Reactivate it on the
          calendar before scheduling new work.
        </p>
      ) : null}
      <div>
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Hourly slots
        </span>
        {loading ? (
          <p className="mt-2 font-body text-[12px] text-on-surface-variant">
            Loading availability…
          </p>
        ) : loadError ? (
          <p className="mt-2 font-body text-[12px] text-error">{loadError}</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.map((slot) => {
              const full = kind === "job" ? slot.jobsFull : slot.requestsFull;
              const selected = selectedHours.has(slot.startTime);
              const startLabel = formatClockTime(slot.startTime);
              const endLabel = formatClockTime(slot.endTime);

              return (
                <button
                  key={slot.startTime}
                  type="button"
                  disabled={pickerDisabled || full}
                  onClick={() => {
                    onStartTimeChange(slot.startTime);
                    onEndTimeChange(defaultCalendarVisitEnd(slot.startTime));
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    pickerDisabled || full
                      ? "cursor-not-allowed border-stone-100 bg-stone-50 opacity-60"
                      : selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/25"
                        : "border-outline-variant/60 bg-white hover:border-primary/40"
                  }`}
                >
                  <p className="font-numeric text-[13px] font-bold text-on-surface">
                    {startLabel} – {endLabel}
                  </p>
                  <p className="mt-1 font-body text-[11px] text-on-surface-variant">
                    {slotStatusLabel(slot, kind)}
                    {slot.personalCount > 0
                      ? ` · ${slot.personalCount} personal`
                      : ""}
                  </p>
                  {full ? (
                    <p className="mt-0.5 font-body text-[10px] font-semibold uppercase text-error">
                      Full
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <CalendarVisitTimeRangeFields
        startTime={startTime}
        endTime={endTime}
        disabled={pickerDisabled}
        onStartTimeChange={onStartTimeChange}
        onEndTimeChange={onEndTimeChange}
      />

      {rangeError ? (
        <p className="rounded-xl border border-error/30 bg-error-container/60 px-3 py-2 font-body text-[12px] text-on-error-container">
          {rangeError}
        </p>
      ) : null}
    </div>
  );
}
