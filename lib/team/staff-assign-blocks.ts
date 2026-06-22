import { buildStaffLeaveBlockMap } from "@/lib/leave/client";
import type { LeaveRequestRecord } from "@/lib/leave/types";
import {
  buildStaffOffDayBlockMap,
  mergeStaffBlockMaps,
} from "@/lib/team/staff-availability";
import type { StaffSummary } from "@/lib/team/staff-summary-cache";

/** Leave and weekly off-day labels for staff assignment pickers. */
export function buildStaffAssignmentBlockMap(
  staff: StaffSummary[],
  leaveRequests: LeaveRequestRecord[],
  ymd: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
  timeZone?: string | null,
): Record<string, string> {
  const ids = staff.map((member) => member.id);
  return mergeStaffBlockMaps(
    buildStaffLeaveBlockMap(leaveRequests, ids, ymd, startTime, endTime),
    buildStaffOffDayBlockMap(staff, ids, ymd, timeZone),
  );
}
