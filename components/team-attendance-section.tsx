"use client";

import { BookingMonthCalendar } from "@/components/booking-slot-date-picker";
import {
  TeamAttendanceDetailDrawer,
  type AttendanceDetailRecord,
} from "@/components/team-attendance-detail-drawer";
import { formatWorkingDuration } from "@/lib/team/attendance";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useMemo, useState } from "react";

type AttendanceRecord = AttendanceDetailRecord;

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatHeadingDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function parseIsoDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function attendanceMinDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return formatDateKey(date);
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function TeamAttendanceSection() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(
    null,
  );

  const loadAttendance = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const date = formatDateKey(selectedDate);
      const response = await fetch(`/api/team/attendance?date=${date}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        attendance?: AttendanceRecord[];
      };

      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error ?? "Could not load attendance.");
      }

      setAttendance(Array.isArray(payload.attendance) ? payload.attendance : []);
    } catch (loadError) {
      setAttendance([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load attendance.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate, user]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    setSelectedRecord(null);
  }, [selectedDate]);

  const activeCount = useMemo(
    () => attendance.filter((record) => record.status === "checked_in").length,
    [attendance],
  );

  const completedCount = attendance.length - activeCount;
  const selectedIso = formatDateKey(selectedDate);
  const minDate = useMemo(() => attendanceMinDate(), []);
  const isToday = isSameCalendarDay(selectedDate, new Date());

  function shiftDate(days: number) {
    setSelectedDate((current) => {
      const next = new Date(current);
      next.setDate(next.getDate() + days);
      return next;
    });
  }

  function selectIsoDate(iso: string) {
    setSelectedDate(parseIsoDate(iso));
  }

  function goToToday() {
    setSelectedDate(new Date());
  }

  const selectedDayLabel = formatHeadingDate(selectedDate);

  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-display text-headline-sm font-semibold text-on-surface">
            Staff attendance
          </h3>
          <p className="font-body text-body-md text-on-surface-variant">
            Clock-in and clock-out times for your team, with breaks deducted.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadAttendance()}
          disabled={isLoading}
          className="flex h-10 items-center justify-center gap-2 self-start rounded-lg border border-outline-variant bg-surface-container-low px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            className={`material-symbols-outlined text-[18px] ${
              isLoading ? "animate-spin" : ""
            }`}
          >
            refresh
          </span>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-outline-variant/60 bg-surface-container-low p-4">
          <div className="mb-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Selected day
            </p>
            <p className="mt-1 font-body text-[14px] font-semibold text-on-surface">
              {selectedDayLabel}
            </p>
          </div>

          <BookingMonthCalendar
            key={selectedIso.slice(0, 7)}
            selectedIso={selectedIso}
            minDate={minDate}
            onSelect={selectIsoDate}
            className="mt-0 w-full max-w-none border-outline-variant/60 bg-surface-container-lowest shadow-none"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => shiftDate(-1)}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              aria-label="Previous day"
            >
              <span className="material-symbols-outlined text-[16px]">
                chevron_left
              </span>
              Prev
            </button>
            <button
              type="button"
              onClick={goToToday}
              disabled={isToday}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-default disabled:opacity-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => shiftDate(1)}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              aria-label="Next day"
            >
              Next
              <span className="material-symbols-outlined text-[16px]">
                chevron_right
              </span>
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Records" value={String(attendance.length)} />
            <StatCard
              label="Currently clocked in"
              value={String(activeCount)}
            />
            <StatCard label="Completed" value={String(completedCount)} />
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                error
              </span>
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-low">
              <div className="flex items-center gap-3 font-body text-body-md text-on-surface-variant">
                <span className="material-symbols-outlined animate-spin text-primary">
                  progress_activity
                </span>
                Loading attendance...
              </div>
            </div>
          ) : attendance.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant bg-surface-container-low px-6 py-10 text-center">
              <span className="material-symbols-outlined mb-2 text-[34px] text-outline">
                schedule
              </span>
              <p className="font-body text-body-md font-semibold text-on-surface">
                No attendance records for this day
              </p>
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                Staff clock-ins will appear here once your team starts work.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-outline-variant/60">
              <div className="hidden grid-cols-[1.4fr_0.9fr_0.9fr_0.8fr_0.8fr_0.7fr] gap-3 border-b border-outline-variant/60 bg-surface-container-low px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant md:grid">
                <span>Staff</span>
                <span>Clock in</span>
                <span>Clock out</span>
                <span>Worked</span>
                <span>Break</span>
                <span>Status</span>
              </div>

              <div className="divide-y divide-outline-variant/60">
                {attendance.map((record) => {
                  const isSelected = selectedRecord?.id === record.id;
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => setSelectedRecord(record)}
                      className={`grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition-colors md:grid-cols-[1.4fr_0.9fr_0.9fr_0.8fr_0.8fr_0.7fr] md:items-center ${
                        isSelected
                          ? "bg-primary/5"
                          : "hover:bg-surface-container-low/80"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={staffAvatarUrl({
                            id: record.staffId,
                            fullName: record.staffName,
                          })}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-xl border border-outline-variant/60 bg-white object-cover"
                        />
                        <div className="min-w-0">
                          <p className="font-body text-[14px] font-semibold text-on-surface">
                            {record.staffName}
                          </p>
                          <p className="font-body text-[12px] text-on-surface-variant">
                            {record.staffRole?.trim() || "Staff"}
                          </p>
                        </div>
                      </div>

                      <AttendanceCell
                        label="Clock in"
                        value={formatTime(record.checkInTime)}
                      />
                      <AttendanceCell
                        label="Clock out"
                        value={formatTime(record.checkOutTime)}
                      />
                      <AttendanceCell
                        label="Worked"
                        value={formatWorkingDuration(record.workingSeconds)}
                      />
                      <AttendanceCell
                        label="Break"
                        value={
                          record.totalBreakSeconds > 0
                            ? formatWorkingDuration(record.totalBreakSeconds)
                            : "—"
                        }
                      />
                      <div className="flex items-center justify-between gap-2 md:justify-start">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wide ${
                            record.status === "checked_in"
                              ? "bg-primary/10 text-primary"
                              : "bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          {record.status === "checked_in" ? "Active" : "Done"}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-on-surface-variant md:hidden">
                          chevron_right
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>

      <TeamAttendanceDetailDrawer
        record={selectedRecord}
        selectedDateLabel={selectedDayLabel}
        onClose={() => setSelectedRecord(null)}
      />
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <p className="mt-1 font-display text-[1.5rem] font-semibold text-on-surface">
        {value}
      </p>
    </div>
  );
}

function AttendanceCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant md:hidden">
        {label}
      </p>
      <p className="font-body text-[13px] font-medium text-on-surface">{value}</p>
    </div>
  );
}
