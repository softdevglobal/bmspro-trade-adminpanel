import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import { parseClockMinutes } from "@/lib/leave/clock";
import type { LeaveRequestRecord } from "@/lib/leave/types";

export type LeaveConflictKind = "job" | "request";

export type LeaveAssignmentConflict = {
  kind: LeaveConflictKind;
  id: string;
  label: string;
  code: string | null;
  scheduledDate: string;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  customerName: string | null;
};

/** Whether a leave window overlaps work on a calendar day. */
export function leaveOverlapsDay(
  leave: Pick<
    LeaveRequestRecord,
    "fromDate" | "toDate" | "isFullDay" | "startTime" | "endTime"
  >,
  ymd: string,
  windowStartMinutes?: number,
  windowEndMinutes?: number,
): boolean {
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

function bookingLabel(
  serviceName: string | null,
  customTitle: string | null,
  bookingCode: string | null,
): string {
  if (serviceName?.trim()) return serviceName.trim();
  if (customTitle?.trim()) return customTitle.trim();
  if (bookingCode?.trim()) return bookingCode.trim();
  return "Scheduled job";
}

function requestLabel(
  serviceName: string | null,
  customTitle: string | null,
  requestCode: string | null,
): string {
  if (serviceName?.trim()) return serviceName.trim();
  if (customTitle?.trim()) return customTitle.trim();
  if (requestCode?.trim()) return requestCode.trim();
  return "Scheduled visit";
}

/** Jobs and requests assigned to the requester that overlap the leave window. */
export async function findLeaveAssignmentConflicts(
  leave: LeaveRequestRecord,
): Promise<LeaveAssignmentConflict[]> {
  if (!leave.businessId || !leave.requesterUid) return [];

  const businessId = leave.businessId;
  const staffUid = leave.requesterUid;
  const conflicts: LeaveAssignmentConflict[] = [];

  const [jobsSnap, requestsSnap] = await Promise.all([
    adminDb
      .collection(JOBS_COLLECTION)
      .where("businessId", "==", businessId)
      .get(),
    adminDb
      .collection(REQUESTS_COLLECTION)
      .where("businessId", "==", businessId)
      .where("assignedTo.uid", "==", staffUid)
      .get(),
  ]);

  for (const doc of jobsSnap.docs) {
    const booking = mapBookingDoc(doc.id, doc.data() ?? {});
    if (booking.assignedTo?.uid !== staffUid) continue;
    if (booking.status !== "scheduled" && booking.status !== "ongoing") {
      continue;
    }

    const ymd = booking.scheduledSlot?.date;
    if (!ymd) continue;

    const startMin = parseClockMinutes(booking.scheduledStartTime) ?? undefined;
    const endMin = parseClockMinutes(booking.scheduledEndTime) ?? undefined;
    if (!leaveOverlapsDay(leave, ymd, startMin, endMin)) continue;

    conflicts.push({
      kind: "job",
      id: booking.id,
      label: bookingLabel(
        booking.serviceName,
        booking.customRequest?.title ?? null,
        booking.bookingCode,
      ),
      code: booking.bookingCode,
      scheduledDate: ymd,
      scheduledStartTime: booking.scheduledStartTime,
      scheduledEndTime: booking.scheduledEndTime,
      customerName: booking.customer.fullName?.trim() || null,
    });
  }

  for (const doc of requestsSnap.docs) {
    const request = mapInspectionDoc(doc.id, doc.data() ?? {});
    if (request.status !== "scheduled") continue;
    if (request.assignedTo?.uid !== staffUid) continue;

    const ymd = request.scheduledSlot?.date;
    if (!ymd) continue;

    const startMin = parseClockMinutes(request.scheduledStartTime) ?? undefined;
    const endMin = parseClockMinutes(request.scheduledEndTime) ?? undefined;
    if (!leaveOverlapsDay(leave, ymd, startMin, endMin)) continue;

    conflicts.push({
      kind: "request",
      id: request.id,
      label: requestLabel(
        request.serviceName,
        request.customRequest?.title ?? null,
        request.requestCode,
      ),
      code: request.requestCode,
      scheduledDate: ymd,
      scheduledStartTime: request.scheduledStartTime,
      scheduledEndTime: request.scheduledEndTime,
      customerName: request.customer.fullName?.trim() || null,
    });
  }

  return conflicts.sort((a, b) => {
    const dateCmp = a.scheduledDate.localeCompare(b.scheduledDate);
    if (dateCmp !== 0) return dateCmp;
    return a.label.localeCompare(b.label);
  });
}
