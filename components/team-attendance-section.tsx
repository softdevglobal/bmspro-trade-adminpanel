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
type AttendancePeriod = "day" | "week" | "biweekly" | "month";
type AttendanceView = "all" | "staff";

type AttendanceRange = {
  start: Date;
  end: Date;
};

type AttendanceStaffSummary = {
  staffId: string;
  staffName: string;
  staffRole: string | null;
  records: AttendanceRecord[];
  workingSeconds: number;
  totalBreakSeconds: number;
  activeCount: number;
  firstCheckInTime: string;
  lastCheckOutTime: string | null;
};

const PERIOD_OPTIONS: { value: AttendancePeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "month", label: "Monthly" },
];

const VIEW_OPTIONS: { value: AttendanceView; label: string }[] = [
  { value: "all", label: "All records" },
  { value: "staff", label: "Staff-wise" },
];

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

function cloneDate(date: Date) {
  return new Date(date.getTime());
}

function addDays(date: Date, days: number) {
  const next = cloneDate(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  const next = cloneDate(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = cloneDate(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(date: Date) {
  const start = startOfDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function attendanceRangeForPeriod(
  selectedDate: Date,
  period: AttendancePeriod,
): AttendanceRange {
  if (period === "week") {
    const start = startOfWeek(selectedDate);
    return { start, end: endOfDay(addDays(start, 6)) };
  }

  if (period === "biweekly") {
    const start = startOfWeek(selectedDate);
    return { start, end: endOfDay(addDays(start, 13)) };
  }

  if (period === "month") {
    const start = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      1,
    );
    const end = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return { start, end };
  }

  return { start: startOfDay(selectedDate), end: endOfDay(selectedDate) };
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatRecordDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function formatShortDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRangeLabel(range: AttendanceRange, period: AttendancePeriod) {
  if (period === "day") return formatHeadingDate(range.start);
  if (formatDateKey(range.start) === formatDateKey(range.end)) {
    return formatShortDate(range.start);
  }
  return `${formatShortDate(range.start)} - ${formatShortDate(range.end)}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function moveDateByPeriod(date: Date, period: AttendancePeriod, direction: -1 | 1) {
  if (period === "month") {
    const next = cloneDate(date);
    const day = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + direction);
    next.setDate(Math.min(day, daysInMonth(next.getFullYear(), next.getMonth())));
    return next;
  }

  const periodDays = period === "biweekly" ? 14 : period === "week" ? 7 : 1;
  return addDays(date, periodDays * direction);
}

function staffSummaryKey(record: AttendanceRecord) {
  return record.staffId || record.staffName;
}

function buildStaffSummaries(records: AttendanceRecord[]) {
  const summaries = new Map<string, AttendanceStaffSummary>();

  for (const record of records) {
    const key = staffSummaryKey(record);
    const existing = summaries.get(key);
    const checkInTime = new Date(record.checkInTime).getTime();
    const checkOutTime = record.checkOutTime
      ? new Date(record.checkOutTime).getTime()
      : null;

    if (!existing) {
      summaries.set(key, {
        staffId: record.staffId,
        staffName: record.staffName,
        staffRole: record.staffRole,
        records: [record],
        workingSeconds: record.workingSeconds,
        totalBreakSeconds: record.totalBreakSeconds,
        activeCount: record.status === "checked_in" ? 1 : 0,
        firstCheckInTime: record.checkInTime,
        lastCheckOutTime: record.checkOutTime,
      });
      continue;
    }

    const firstCheckInTime = new Date(existing.firstCheckInTime).getTime();
    const lastCheckOutTime = existing.lastCheckOutTime
      ? new Date(existing.lastCheckOutTime).getTime()
      : null;

    existing.records.push(record);
    existing.workingSeconds += record.workingSeconds;
    existing.totalBreakSeconds += record.totalBreakSeconds;
    existing.activeCount += record.status === "checked_in" ? 1 : 0;
    if (checkInTime < firstCheckInTime) {
      existing.firstCheckInTime = record.checkInTime;
    }
    if (
      checkOutTime !== null &&
      (lastCheckOutTime === null || checkOutTime > lastCheckOutTime)
    ) {
      existing.lastCheckOutTime = record.checkOutTime;
    }
  }

  return Array.from(summaries.values()).sort((a, b) =>
    a.staffName.localeCompare(b.staffName),
  );
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
  const [selectedPeriod, setSelectedPeriod] =
    useState<AttendancePeriod>("day");
  const [selectedView, setSelectedView] = useState<AttendanceView>("all");
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(
    null,
  );
  const selectedRange = useMemo(
    () => attendanceRangeForPeriod(selectedDate, selectedPeriod),
    [selectedDate, selectedPeriod],
  );
  const rangeStartIso = formatDateKey(selectedRange.start);
  const rangeEndIso = formatDateKey(selectedRange.end);

  const loadAttendance = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({
        start: rangeStartIso,
        end: rangeEndIso,
      });
      const response = await fetch(`/api/team/attendance?${params}`, {
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
  }, [rangeEndIso, rangeStartIso, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAttendance();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAttendance]);

  const activeCount = useMemo(
    () => attendance.filter((record) => record.status === "checked_in").length,
    [attendance],
  );

  const completedCount = attendance.length - activeCount;
  const totalWorkedSeconds = useMemo(
    () => attendance.reduce((sum, record) => sum + record.workingSeconds, 0),
    [attendance],
  );
  const staffSummaries = useMemo(
    () => buildStaffSummaries(attendance),
    [attendance],
  );
  const selectedIso = formatDateKey(selectedDate);
  const minDate = useMemo(() => attendanceMinDate(), []);
  const isToday = isSameCalendarDay(selectedDate, new Date());

  function shiftPeriod(direction: -1 | 1) {
    setSelectedRecord(null);
    setSelectedDate((current) =>
      moveDateByPeriod(current, selectedPeriod, direction),
    );
  }

  function selectIsoDate(iso: string) {
    setSelectedRecord(null);
    setSelectedDate(parseIsoDate(iso));
  }

  function goToToday() {
    setSelectedRecord(null);
    setSelectedDate(new Date());
  }

  const selectedPeriodLabel = formatRangeLabel(selectedRange, selectedPeriod);
  const drawerDateLabel = selectedRecord
    ? formatHeadingDate(new Date(selectedRecord.checkInTime))
    : selectedPeriodLabel;

  return (
    <>
      <section className="flex flex-col gap-4 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-display text-headline-sm font-semibold text-on-surface">
              Staff attendance
            </h3>
            <p className="font-body text-body-md text-on-surface-variant">
              View attendance for all records or staff-wise totals by day, week,
              biweekly, or month.
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
            <div className="mb-4">
              <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                Selected period
              </p>
              <p className="mt-1 font-body text-[14px] font-semibold text-on-surface">
                {selectedPeriodLabel}
              </p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2">
              {PERIOD_OPTIONS.map((option) => {
                const active = selectedPeriod === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSelectedRecord(null);
                      setSelectedPeriod(option.value);
                    }}
                    className={`rounded-lg border px-3 py-2 text-left font-body text-[12px] font-semibold transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
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
                onClick={() => shiftPeriod(-1)}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                aria-label="Previous period"
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
                onClick={() => shiftPeriod(1)}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
                aria-label="Next period"
              >
                Next
                <span className="material-symbols-outlined text-[16px]">
                  chevron_right
                </span>
              </button>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Records" value={String(attendance.length)} />
              <StatCard label="Staff" value={String(staffSummaries.length)} />
              <StatCard label="Active" value={String(activeCount)} />
              <StatCard
                label="Worked"
                value={formatWorkingDuration(totalWorkedSeconds)}
              />
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-low p-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="px-2 font-body text-[12px] font-semibold text-on-surface-variant">
                Showing {completedCount} completed and {activeCount} active
                records
              </p>
              <div className="flex flex-wrap gap-2">
                {VIEW_OPTIONS.map((option) => {
                  const active = selectedView === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSelectedRecord(null);
                        setSelectedView(option.value);
                      }}
                      className={`rounded-lg px-3 py-2 font-body text-[12px] font-semibold transition-colors ${
                        active
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
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
                  No attendance records for this period
                </p>
                <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                  Staff clock-ins will appear here once your team starts work.
                </p>
              </div>
            ) : selectedView === "staff" ? (
              <StaffSummaryTable summaries={staffSummaries} />
            ) : (
              <AttendanceRecordsTable
                attendance={attendance}
                selectedRecordId={selectedRecord?.id ?? null}
                onSelect={setSelectedRecord}
              />
            )}
          </div>
        </div>
      </section>

      <TeamAttendanceDetailDrawer
        record={selectedRecord}
        selectedDateLabel={drawerDateLabel}
        onClose={() => setSelectedRecord(null)}
      />
    </>
  );
}

function AttendanceRecordsTable({
  attendance,
  selectedRecordId,
  onSelect,
}: {
  attendance: AttendanceRecord[];
  selectedRecordId: string | null;
  onSelect: (record: AttendanceRecord) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/60">
      <div className="hidden grid-cols-[1.3fr_0.75fr_0.85fr_0.85fr_0.75fr_0.75fr_0.65fr] gap-3 border-b border-outline-variant/60 bg-surface-container-low px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant md:grid">
        <span>Staff</span>
        <span>Day</span>
        <span>Clock in</span>
        <span>Clock out</span>
        <span>Worked</span>
        <span>Break</span>
        <span>Status</span>
      </div>

      <div className="divide-y divide-outline-variant/60">
        {attendance.map((record) => {
          const isSelected = selectedRecordId === record.id;
          return (
            <button
              key={record.id}
              type="button"
              onClick={() => onSelect(record)}
              className={`grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition-colors md:grid-cols-[1.3fr_0.75fr_0.85fr_0.85fr_0.75fr_0.75fr_0.65fr] md:items-center ${
                isSelected ? "bg-primary/5" : "hover:bg-surface-container-low/80"
              }`}
            >
              <StaffIdentity record={record} />
              <AttendanceCell label="Day" value={formatRecordDay(record.checkInTime)} />
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
              <StatusBadge status={record.status} showChevron />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StaffSummaryTable({
  summaries,
}: {
  summaries: AttendanceStaffSummary[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/60">
      <div className="hidden grid-cols-[1.4fr_0.6fr_0.95fr_0.95fr_0.8fr_0.8fr_0.75fr] gap-3 border-b border-outline-variant/60 bg-surface-container-low px-4 py-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant md:grid">
        <span>Staff</span>
        <span>Shifts</span>
        <span>First in</span>
        <span>Last out</span>
        <span>Worked</span>
        <span>Break</span>
        <span>Status</span>
      </div>

      <div className="divide-y divide-outline-variant/60">
        {summaries.map((summary) => (
          <div
            key={summary.staffId || summary.staffName}
            className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[1.4fr_0.6fr_0.95fr_0.95fr_0.8fr_0.8fr_0.75fr] md:items-center"
          >
            <StaffIdentity record={summary.records[0]} />
            <AttendanceCell
              label="Shifts"
              value={String(summary.records.length)}
            />
            <AttendanceCell
              label="First in"
              value={formatShortDateTime(summary.firstCheckInTime)}
            />
            <AttendanceCell
              label="Last out"
              value={formatShortDateTime(summary.lastCheckOutTime)}
            />
            <AttendanceCell
              label="Worked"
              value={formatWorkingDuration(summary.workingSeconds)}
            />
            <AttendanceCell
              label="Break"
              value={
                summary.totalBreakSeconds > 0
                  ? formatWorkingDuration(summary.totalBreakSeconds)
                  : "—"
              }
            />
            <div className="flex items-center justify-between gap-2 md:justify-start">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wide ${
                  summary.activeCount > 0
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {summary.activeCount > 0
                  ? `${summary.activeCount} active`
                  : "Complete"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffIdentity({ record }: { record: AttendanceRecord }) {
  return (
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
  );
}

function attendanceStatusLabel(status: string) {
  if (status === "checked_in") return "Active";
  if (status === "auto_checked_out") return "Auto out";
  return "Done";
}

function StatusBadge({
  status,
  showChevron = false,
}: {
  status: string;
  showChevron?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 md:justify-start">
      <span
        className={`inline-flex rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wide ${
          status === "checked_in"
            ? "bg-primary/10 text-primary"
            : "bg-surface-container-high text-on-surface-variant"
        }`}
      >
        {attendanceStatusLabel(status)}
      </span>
      {showChevron ? (
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant md:hidden">
          chevron_right
        </span>
      ) : null}
    </div>
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
