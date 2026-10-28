import "server-only";

import type { InspectionAssignment } from "@/lib/inspection/types";
import { findApprovedLeaveBlocking, findLeaveBlockingAssignment } from "@/lib/leave/server";
import {
  notifyBusinessOfStaffOffDayAssignment,
  notifyBusinessOfStaffOnLeaveAssignment,
} from "@/lib/notifications/server";
import { staffIsOffOnDate } from "@/lib/team/staff-off-day-server";

/** "HH:MM" → minutes since midnight, or null. */
export function clockToMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = parts.length > 1 ? Number.parseInt(parts[1] ?? "", 10) : 0;
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

/**
 * Blocks assigning a staff member when they have leave or a weekly off day.
 * Returns an error message if blocked, otherwise null.
 */
export async function staffAssignmentBlockMessage(
  businessId: string,
  assignment: InspectionAssignment | null,
  ymd: string | null,
  windowStart?: number | null,
  windowEnd?: number | null,
  targetKind: "job" | "request" = "request",
  targetId?: string,
): Promise<string | null> {
  if (!assignment || assignment.type !== "staff" || !ymd) return null;
  const blocking = await findApprovedLeaveBlocking(
    businessId,
    assignment.uid,
    ymd,
    windowStart ?? undefined,
    windowEnd ?? undefined,
  );
  if (blocking) {
    if (targetId) {
      void notifyBusinessOfStaffOnLeaveAssignment(
        businessId,
        assignment.name,
        ymd,
        "approved",
        targetKind,
        targetId,
      );
    }
    return `${assignment.name} has approved time off on ${ymd} and cannot be assigned that day.`;
  }

  const pending = await findLeaveBlockingAssignment(
    businessId,
    assignment.uid,
    ymd,
    windowStart ?? undefined,
    windowEnd ?? undefined,
  );
  if (pending?.status === "pending") {
    if (targetId) {
      void notifyBusinessOfStaffOnLeaveAssignment(
        businessId,
        assignment.name,
        ymd,
        "pending",
        targetKind,
        targetId,
      );
    }
    return `${assignment.name} has a pending leave request on ${ymd} and cannot be assigned that day.`;
  }

  const offDay = await staffIsOffOnDate(assignment.uid, ymd, businessId);
  if (offDay) {
    if (targetId) {
      void notifyBusinessOfStaffOffDayAssignment(
        businessId,
        assignment.name,
        ymd,
        targetKind,
        targetId,
      );
    }
    return `${assignment.name} is not scheduled to work on ${ymd} and cannot be assigned that day.`;
  }

  return null;
}
