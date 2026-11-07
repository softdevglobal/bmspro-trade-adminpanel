import { adminDb } from "@/lib/firebase/admin";
import type { InspectionAssignment } from "@/lib/inspection/types";
import { mapBookingDoc, bookingScheduleDays } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import {
  findApprovedLeaveBlocking,
  findLeaveBlockingAssignment,
} from "@/lib/leave/server";
import {
  notifyBusinessOfStaffOffDayAssignment,
  notifyBusinessOfStaffOnLeaveAssignment,
} from "@/lib/notifications/server";
import { staffIsOffOnDate } from "@/lib/team/staff-off-day-server";

function clockToMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = parts.length > 1 ? Number.parseInt(parts[1] ?? "", 10) : 0;
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

export async function resolveStaffAssignment(
  businessId: string,
  staffId: string,
): Promise<InspectionAssignment | null> {
  const snap = await adminDb.collection("users").doc(staffId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || data.businessId !== businessId || data.role !== "staff") {
    return null;
  }
  return {
    type: "staff",
    uid: snap.id,
    name: typeof data.fullName === "string" ? data.fullName : "Staff member",
    email: typeof data.email === "string" ? data.email : null,
  };
}

export async function resolveOwnerAssignment(
  uid: string,
  email: string | undefined,
): Promise<InspectionAssignment> {
  const snap = await adminDb.collection("users").doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  return {
    type: "owner",
    uid,
    name:
      data && typeof data.fullName === "string" && data.fullName.trim()
        ? data.fullName
        : email ?? "Business owner",
    email: email ?? null,
  };
}

type ValidateStaffAssignmentOptions = {
  notifyOnConflict?: boolean;
  notifyContext?: { kind: "job"; id: string };
  excludeBookingId?: string;
  excludeSeriesId?: string | null;
};

function visitWindowOverlaps(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  timeRange: unknown,
  startMin: number,
  endMin: number,
): boolean {
  const start = clockToMinutes(startTime) ?? (timeRange === "afternoon" ? 12 * 60 : 8 * 60);
  const end = clockToMinutes(endTime) ?? (timeRange === "morning" ? 12 * 60 : 17 * 60);
  return start < endMin && startMin < end;
}

export async function validateStaffAssignmentForSchedule(
  businessId: string,
  assignment: InspectionAssignment,
  scheduledDate: string | null,
  scheduledStartTime: string | null,
  scheduledEndTime: string | null,
  options: ValidateStaffAssignmentOptions = {},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (assignment.type !== "staff" || !scheduledDate) {
    return { ok: true };
  }

  const profile = await adminDb.collection("users").doc(assignment.uid).get();
  const staff = profile.data();
  if (
    !profile.exists ||
    !staff ||
    staff.businessId !== businessId ||
    staff.role !== "staff" ||
    staff.isActive === false ||
    staff.disabled === true ||
    staff.suspended === true ||
    ["inactive", "disabled", "suspended"].includes(String(staff.status ?? ""))
  ) {
    return {
      ok: false,
      status: 409,
      error: `${assignment.name} is no longer an active team member and cannot be assigned.`,
    };
  }

  const startMin = clockToMinutes(scheduledStartTime) ?? undefined;
  const endMin = clockToMinutes(scheduledEndTime) ?? undefined;
  const blocking = await findApprovedLeaveBlocking(
    businessId,
    assignment.uid,
    scheduledDate,
    startMin,
    endMin,
  );
  if (blocking) {
    if (options.notifyOnConflict && options.notifyContext) {
      void notifyBusinessOfStaffOnLeaveAssignment(
        businessId,
        assignment.name,
        scheduledDate,
        "approved",
        options.notifyContext.kind,
        options.notifyContext.id,
      );
    }
    return {
      ok: false,
      status: 409,
      error: `${assignment.name} has approved time off on ${scheduledDate} and cannot be assigned that day.`,
    };
  }

  const pending = await findLeaveBlockingAssignment(
    businessId,
    assignment.uid,
    scheduledDate,
    startMin,
    endMin,
  );
  if (pending?.status === "pending") {
    if (options.notifyOnConflict && options.notifyContext) {
      void notifyBusinessOfStaffOnLeaveAssignment(
        businessId,
        assignment.name,
        scheduledDate,
        "pending",
        options.notifyContext.kind,
        options.notifyContext.id,
      );
    }
    return {
      ok: false,
      status: 409,
      error: `${assignment.name} has a pending leave request on ${scheduledDate} and cannot be assigned that day.`,
    };
  }

  const offDay = await staffIsOffOnDate(
    assignment.uid,
    scheduledDate,
    businessId,
  );
  if (offDay) {
    if (options.notifyOnConflict && options.notifyContext) {
      void notifyBusinessOfStaffOffDayAssignment(
        businessId,
        assignment.name,
        scheduledDate,
        options.notifyContext.kind,
        options.notifyContext.id,
      );
    }
    return {
      ok: false,
      status: 409,
      error: `${assignment.name} is not scheduled to work on ${scheduledDate} and cannot be assigned that day.`,
    };
  }

  const [jobsSnap, requestsSnap] = await Promise.all([
    adminDb
      .collection(JOBS_COLLECTION)
      .where("businessId", "==", businessId)
      .get(),
    adminDb
      .collection(REQUESTS_COLLECTION)
      .where("businessId", "==", businessId)
      .where("assignedTo.uid", "==", assignment.uid)
      .get(),
  ]);

  for (const doc of jobsSnap.docs) {
    if (doc.id === options.excludeBookingId) continue;
    const booking = mapBookingDoc(doc.id, doc.data() ?? {});
    if (
      booking.assignedTo?.uid !== assignment.uid ||
      !["awaiting", "scheduled", "ongoing"].includes(booking.status)
    ) {
      continue;
    }
    const days =
      options.excludeSeriesId && booking.seriesId === options.excludeSeriesId
        ? [
            ...(booking.scheduledSlot?.date
              ? [{
                  date: booking.scheduledSlot.date,
                  slot: booking.scheduledSlot,
                  startTime: booking.scheduledStartTime,
                  endTime: booking.scheduledEndTime,
                }]
              : []),
            ...booking.additionalJobDays.map((slot) => ({
              date: slot.date,
              slot,
              startTime: slot.startTime,
              endTime: slot.endTime,
            })),
          ]
        : bookingScheduleDays(booking);
    const visit = days.find((day) => day.date === scheduledDate);
    if (
      visit &&
      visitWindowOverlaps(
        visit.startTime,
        visit.endTime,
        visit.slot.timeRange,
        startMin ?? 8 * 60,
        endMin ?? 17 * 60,
      )
    ) {
      return {
        ok: false,
        status: 409,
        error: `${assignment.name} already has a job scheduled on ${scheduledDate} during that time.`,
      };
    }
  }

  for (const doc of requestsSnap.docs) {
    const request = mapInspectionDoc(doc.id, doc.data() ?? {});
    const slot = request.scheduledSlot;
    if (request.status !== "scheduled" || !slot || slot.date !== scheduledDate) continue;
    if (
      visitWindowOverlaps(
        request.scheduledStartTime,
        request.scheduledEndTime,
        slot.timeRange,
        startMin ?? 8 * 60,
        endMin ?? 17 * 60,
      )
    ) {
      return {
        ok: false,
        status: 409,
        error: `${assignment.name} already has an inspection scheduled on ${scheduledDate} during that time.`,
      };
    }
  }

  return { ok: true };
}

export async function resolveJobAssignmentFromPayload(input: {
  businessId: string;
  ownerUid: string;
  ownerEmail?: string | null;
  assignTo: string;
  staffId?: string;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  notifyOnConflict?: boolean;
  notifyContext?: { kind: "job"; id: string };
}): Promise<
  | { ok: true; assignment: InspectionAssignment | null }
  | { ok: false; status: number; error: string }
> {
  const assignTo = input.assignTo.trim();
  if (!assignTo || assignTo === "none") {
    return { ok: true, assignment: null };
  }

  let assignment: InspectionAssignment | null = null;

  if (assignTo === "owner") {
    assignment = await resolveOwnerAssignment(
      input.ownerUid,
      input.ownerEmail ?? undefined,
    );
  } else if (assignTo === "staff") {
    const staffId = input.staffId?.trim() ?? "";
    if (!staffId) {
      return {
        ok: false,
        status: 400,
        error: "Choose a team member to assign.",
      };
    }
    assignment = await resolveStaffAssignment(input.businessId, staffId);
    if (!assignment) {
      return {
        ok: false,
        status: 400,
        error: "Selected team member is unavailable.",
      };
    }
  } else {
    return {
      ok: false,
      status: 400,
      error: "Choose who should run this job.",
    };
  }

  const validation = await validateStaffAssignmentForSchedule(
    input.businessId,
    assignment,
    input.scheduledDate,
    input.scheduledStartTime,
    input.scheduledEndTime,
    {
      notifyOnConflict: input.notifyOnConflict,
      notifyContext: input.notifyContext,
    },
  );
  if (!validation.ok) {
    return validation;
  }

  return { ok: true, assignment };
}
