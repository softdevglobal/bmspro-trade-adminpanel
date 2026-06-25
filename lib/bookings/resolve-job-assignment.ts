import { adminDb } from "@/lib/firebase/admin";
import type { InspectionAssignment } from "@/lib/inspection/types";
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
};

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
