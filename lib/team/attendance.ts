type TimestampLike = {
  toDate: () => Date;
};

export type AttendanceBreakPeriod = {
  startTime: string;
  endTime: string | null;
  durationSeconds: number;
};

export type TeamAttendanceRecord = {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: string | null;
  checkInTime: string;
  checkOutTime: string | null;
  status: string;
  workingSeconds: number;
  totalBreakSeconds: number;
  breakPeriods: AttendanceBreakPeriod[];
};

function timestampMillis(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as TimestampLike).toDate === "function"
  ) {
    return (value as TimestampLike).toDate().getTime();
  }

  return 0;
}

function timestampIso(value: unknown) {
  const millis = timestampMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
}

function sanitizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDateParam(value: string | null) {
  if (!value) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function getDayBounds(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start, end };
}

function parseBreakPeriods(raw: unknown, endTime: Date) {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const startMillis = timestampMillis(item.startTime);
      const endMillis = timestampMillis(item.endTime);
      const startTime = startMillis > 0 ? new Date(startMillis) : null;
      const breakEnd = endMillis > 0 ? new Date(endMillis) : null;
      const durationSeconds =
        startTime != null
          ? Math.max(
              0,
              Math.floor(
                ((breakEnd ?? endTime).getTime() - startTime.getTime()) / 1000,
              ),
            )
          : 0;

      return {
        startTime: startTime ? startTime.toISOString() : "",
        endTime: breakEnd ? breakEnd.toISOString() : null,
        durationSeconds,
      } satisfies AttendanceBreakPeriod;
    })
    .filter((item) => item.startTime.length > 0);
}

export function formatWorkingDuration(workingSeconds: number) {
  if (workingSeconds <= 0) return "0m";
  if (workingSeconds < 60) return `${workingSeconds}s`;

  const hours = Math.floor(workingSeconds / 3600);
  const minutes = Math.floor((workingSeconds % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function calculateWorkingSeconds(input: {
  checkInTime: Date;
  checkOutTime: Date | null;
  breakPeriods: AttendanceBreakPeriod[];
  now?: Date;
}) {
  const end = input.checkOutTime ?? input.now ?? new Date();
  const totalSeconds = Math.max(
    0,
    Math.floor((end.getTime() - input.checkInTime.getTime()) / 1000),
  );
  const breakSeconds = input.breakPeriods.reduce(
    (sum, item) => sum + item.durationSeconds,
    0,
  );

  return Math.max(0, totalSeconds - breakSeconds);
}

export function serializeAttendanceRecord(
  id: string,
  data: Record<string, unknown>,
): TeamAttendanceRecord | null {
  const checkInMillis = timestampMillis(data.checkInTime);
  if (checkInMillis <= 0) return null;

  const checkInTime = new Date(checkInMillis);
  const checkOutMillis = timestampMillis(data.checkOutTime);
  const checkOutTime = checkOutMillis > 0 ? new Date(checkOutMillis) : null;
  const endForBreaks = checkOutTime ?? new Date();
  const breakPeriods = parseBreakPeriods(data.breakPeriods, endForBreaks);
  const storedWorkingSeconds =
    typeof data.workingSeconds === "number" ? data.workingSeconds : null;
  const storedBreakSeconds =
    typeof data.totalBreakSeconds === "number" ? data.totalBreakSeconds : null;
  const totalBreakSeconds =
    storedBreakSeconds ??
    breakPeriods.reduce((sum, item) => sum + item.durationSeconds, 0);
  const workingSeconds =
    storedWorkingSeconds ??
    calculateWorkingSeconds({
      checkInTime,
      checkOutTime,
      breakPeriods,
    });

  return {
    id,
    staffId: sanitizeString(data.staffId),
    staffName: sanitizeString(data.staffName) || "Unknown",
    staffRole: sanitizeString(data.staffRole) || null,
    checkInTime: checkInTime.toISOString(),
    checkOutTime: checkOutTime ? checkOutTime.toISOString() : null,
    status: sanitizeString(data.status) || "checked_in",
    workingSeconds,
    totalBreakSeconds,
    breakPeriods,
  };
}

export function filterAttendanceByDate(
  records: TeamAttendanceRecord[],
  dateStr: string,
) {
  const { start, end } = getDayBounds(dateStr);
  return records.filter((record) => {
    const checkIn = new Date(record.checkInTime);
    return checkIn >= start && checkIn <= end;
  });
}

export function parseAttendanceDateParam(value: string | null) {
  return parseDateParam(value);
}
