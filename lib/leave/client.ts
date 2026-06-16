import type { LeaveRequestRecord } from "@/lib/leave/types";

export function parseClockMinutes(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const parts = raw.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = parts.length > 1 ? Number.parseInt(parts[1] ?? "", 10) : 0;
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

/** Mirrors server leaveBlocksDay — client-side preview before submit. */
export function leaveBlocksDay(
  leave: LeaveRequestRecord,
  ymd: string,
  windowStartMinutes?: number,
  windowEndMinutes?: number,
): boolean {
  if (leave.status !== "approved") return false;
  const from = leave.fromDate;
  const to = leave.toDate ?? leave.fromDate;
  if (!from || !to) return false;
  if (ymd < from || ymd > to) return false;

  if (leave.isFullDay) return true;

  const start = parseClockMinutes(leave.startTime);
  const end = parseClockMinutes(leave.endTime);
  if (start == null || end == null || end <= start) return true;

  if (windowStartMinutes == null || windowEndMinutes == null) return true;

  return windowStartMinutes < end && start < windowEndMinutes;
}

export function findLeaveBlockingStaff(
  approvedLeaves: LeaveRequestRecord[],
  staffUid: string,
  ymd: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): LeaveRequestRecord | null {
  if (!staffUid || !ymd) return null;
  const startMin = parseClockMinutes(startTime ?? null);
  const endMin = parseClockMinutes(endTime ?? null);
  for (const leave of approvedLeaves) {
    if (leave.requesterUid !== staffUid) continue;
    if (
      leaveBlocksDay(
        leave,
        ymd,
        startMin ?? undefined,
        endMin ?? undefined,
      )
    ) {
      return leave;
    }
  }
  return null;
}

export function staffLeaveBlockLabel(leave: LeaveRequestRecord): string {
  return leave.isFullDay ? "On leave" : "On leave (partial day)";
}

export function buildStaffLeaveBlockMap(
  approvedLeaves: LeaveRequestRecord[],
  staffIds: string[],
  ymd: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!ymd) return map;
  for (const id of staffIds) {
    const blocking = findLeaveBlockingStaff(
      approvedLeaves,
      id,
      ymd,
      startTime,
      endTime,
    );
    if (blocking) map[id] = staffLeaveBlockLabel(blocking);
  }
  return map;
}
