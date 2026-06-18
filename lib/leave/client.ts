import { parseClockMinutes } from "@/lib/leave/clock";
import type { LeaveRequestRecord } from "@/lib/leave/types";

export { parseClockMinutes };

/** Mirrors server leaveBlocksDay — client-side preview before submit. */
export function leaveBlocksDay(
  leave: LeaveRequestRecord,
  ymd: string,
  windowStartMinutes?: number,
  windowEndMinutes?: number,
): boolean {
  if (leave.status !== "approved" && leave.status !== "pending") return false;
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
  leaves: LeaveRequestRecord[],
  staffUid: string,
  ymd: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): LeaveRequestRecord | null {
  if (!staffUid || !ymd) return null;
  const startMin = parseClockMinutes(startTime ?? null);
  const endMin = parseClockMinutes(endTime ?? null);
  for (const leave of leaves) {
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
  if (leave.status === "pending") {
    return leave.isFullDay ? "Leave pending" : "Leave pending (partial)";
  }
  return leave.isFullDay ? "On leave" : "On leave (partial day)";
}

export function buildStaffLeaveBlockMap(
  leaves: LeaveRequestRecord[],
  staffIds: string[],
  ymd: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): Record<string, string> {
  const active = leaves.filter(
    (item) => item.status === "approved" || item.status === "pending",
  );
  const map: Record<string, string> = {};
  if (!ymd) return map;
  for (const id of staffIds) {
    const blocking = findLeaveBlockingStaff(
      active,
      id,
      ymd,
      startTime,
      endTime,
    );
    if (blocking) map[id] = staffLeaveBlockLabel(blocking);
  }
  return map;
}
