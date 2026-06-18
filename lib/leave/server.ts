import { assignBusinessBooking } from "@/lib/bookings/server";
import { adminDb } from "@/lib/firebase/admin";
import { applyOwnerAction } from "@/lib/inspection/server";
import type { InspectionAssignment } from "@/lib/inspection/types";
import { parseClockMinutes } from "@/lib/leave/clock";
import {
  findLeaveAssignmentConflicts,
  leaveOverlapsDay,
  type LeaveAssignmentConflict,
} from "@/lib/leave/conflicts";
import { platformTodayIso } from "@/lib/platform/timezone";
import {
  notifyBusinessOfStaffLeaveRequest,
} from "@/lib/notifications/server";
import {
  resolveBusinessOwnerUid,
} from "@/lib/notifications/push";
import type {
  LeaveReassignment,
  LeaveRequestRecord,
  LeaveStatus,
} from "@/lib/leave/types";
import {
  resolveOwnerAssignment,
  resolveStaffAssignment,
} from "@/lib/team/resolve-assignment";
import { staffIsOffOnDate } from "@/lib/team/staff-off-day-server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const LEAVE_COLLECTION = "leaveRequests";

function normalizeStatus(value: unknown): LeaveStatus {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "approved") return "approved";
  if (raw === "rejected" || raw === "declined") return "rejected";
  return "pending";
}

function readMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Local (platform tz) calendar day for a stored timestamp. */
function readPlatformDay(value: unknown): string | null {
  const millis = readMillis(value);
  if (millis == null) return null;
  return platformTodayIso(new Date(millis));
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseYmdToMillis(ymd: string): number | null {
  if (!isIsoDate(ymd)) return null;
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

export function mapLeaveDoc(
  id: string,
  data: Record<string, unknown>,
): LeaveRequestRecord {
  return {
    id,
    businessId: trimOrNull(data.businessId),
    ownerUid: trimOrNull(data.ownerUid),
    requesterUid: trimOrNull(data.requesterUid) ?? "",
    requesterName: trimOrNull(data.requesterName) ?? "Team member",
    requesterRole: trimOrNull(data.requesterRole),
    fromDate: readPlatformDay(data.fromDate),
    toDate: readPlatformDay(data.toDate),
    fromMillis: readMillis(data.fromDate),
    toMillis: readMillis(data.toDate),
    isFullDay: data.isFullDay !== false,
    startTime: trimOrNull(data.startTime),
    endTime: trimOrNull(data.endTime),
    reason: trimOrNull(data.reason),
    attachmentUrl: trimOrNull(data.attachmentUrl),
    status: normalizeStatus(data.status),
    rejectionReason: trimOrNull(data.rejectionReason),
    createdAtIso:
      readMillis(data.createdAt) != null
        ? new Date(readMillis(data.createdAt) as number).toISOString()
        : null,
    createdAtMillis: readMillis(data.createdAt),
  };
}

/** Leave requests for a business (newest first). Scoped by businessId. */
export async function listBusinessLeaveRequests(
  businessId: string,
): Promise<LeaveRequestRecord[]> {
  const snap = await adminDb
    .collection(LEAVE_COLLECTION)
    .where("businessId", "==", businessId)
    .get();

  return snap.docs
    .map((doc) => mapLeaveDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0));
}

/** Approved leave for a business — used to block assignment on leave days. */
export async function listApprovedLeaveForBusiness(
  businessId: string,
): Promise<LeaveRequestRecord[]> {
  const snap = await adminDb
    .collection(LEAVE_COLLECTION)
    .where("businessId", "==", businessId)
    .where("status", "==", "approved")
    .get();

  return snap.docs.map((doc) => mapLeaveDoc(doc.id, doc.data() ?? {}));
}

/**
 * Does this approved leave block the given calendar day (and optional
 * minute window)? `ymd` and the leave range are compared as platform-local
 * calendar days.
 */
function leaveBlocksDay(
  leave: LeaveRequestRecord,
  ymd: string,
  windowStartMinutes?: number,
  windowEndMinutes?: number,
): boolean {
  if (leave.status !== "approved") return false;
  return leaveOverlapsDay(leave, ymd, windowStartMinutes, windowEndMinutes);
}

/**
 * Returns the blocking leave record if `staffUid` has approved leave on the
 * given platform-local day (optionally limited to a clock-time window).
 */
export async function findApprovedLeaveBlocking(
  businessId: string,
  staffUid: string,
  ymd: string,
  windowStartMinutes?: number,
  windowEndMinutes?: number,
): Promise<LeaveRequestRecord | null> {
  if (!staffUid || !ymd) return null;
  const approved = await listApprovedLeaveForBusiness(businessId);
  for (const leave of approved) {
    if (leave.requesterUid !== staffUid) continue;
    if (leaveBlocksDay(leave, ymd, windowStartMinutes, windowEndMinutes)) {
      return leave;
    }
  }
  return null;
}

/** Pending or approved leave overlapping a work day (for admin warnings). */
export async function findLeaveBlockingAssignment(
  businessId: string,
  staffUid: string,
  ymd: string,
  windowStartMinutes?: number,
  windowEndMinutes?: number,
): Promise<LeaveRequestRecord | null> {
  if (!staffUid || !ymd) return null;
  const snap = await adminDb
    .collection(LEAVE_COLLECTION)
    .where("businessId", "==", businessId)
    .where("requesterUid", "==", staffUid)
    .get();

  for (const doc of snap.docs) {
    const leave = mapLeaveDoc(doc.id, doc.data() ?? {});
    if (leave.status !== "approved" && leave.status !== "pending") continue;
    if (leaveOverlapsDay(leave, ymd, windowStartMinutes, windowEndMinutes)) {
      return leave;
    }
  }
  return null;
}

export type LeaveDecisionResult =
  | { ok: true; leave: LeaveRequestRecord }
  | { ok: false; status: number; error: string };

export type CreateStaffLeaveResult =
  | { ok: true; leave: LeaveRequestRecord }
  | { ok: false; status: number; error: string };

export type CreateStaffLeaveInput = {
  fromDate: string;
  toDate?: string;
  isFullDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason?: string | null;
  attachmentUrl?: string | null;
};

function conflictKey(conflict: LeaveAssignmentConflict): string {
  return `${conflict.kind}:${conflict.id}`;
}

async function resolveLeaveReassignment(
  businessId: string,
  reassignment: LeaveReassignment,
  reviewerUid: string,
  reviewerEmail: string | undefined,
): Promise<
  | { ok: true; assignment: InspectionAssignment }
  | { ok: false; status: number; error: string }
> {
  if (reassignment.assignTo === "owner") {
    return {
      ok: true,
      assignment: await resolveOwnerAssignment(reviewerUid, reviewerEmail),
    };
  }

  const staffId = reassignment.staffId?.trim() ?? "";
  if (!staffId) {
    return {
      ok: false,
      status: 400,
      error: "Choose a team member for each reassignment.",
    };
  }

  const assignment = await resolveStaffAssignment(businessId, staffId);
  if (!assignment) {
    return {
      ok: false,
      status: 400,
      error: "Selected team member is unavailable.",
    };
  }

  return { ok: true, assignment };
}

async function applyLeaveReassignments(
  businessId: string,
  conflicts: LeaveAssignmentConflict[],
  reassignments: LeaveReassignment[],
  reviewerUid: string,
  reviewerEmail: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const byKey = new Map<string, LeaveReassignment>();
  for (const item of reassignments) {
    byKey.set(`${item.kind}:${item.id}`, item);
  }

  for (const conflict of conflicts) {
    const reassignment = byKey.get(conflictKey(conflict));
    if (!reassignment) {
      return {
        ok: false,
        status: 409,
        error:
          "Reassign every scheduled job and visit before approving this leave.",
      };
    }

    const resolved = await resolveLeaveReassignment(
      businessId,
      reassignment,
      reviewerUid,
      reviewerEmail,
    );
    if (!resolved.ok) return resolved;

    if (resolved.assignment.type === "staff") {
      const blocking = await findApprovedLeaveBlocking(
        businessId,
        resolved.assignment.uid,
        conflict.scheduledDate,
        parseClockMinutes(conflict.scheduledStartTime) ?? undefined,
        parseClockMinutes(conflict.scheduledEndTime) ?? undefined,
      );
      if (blocking) {
        return {
          ok: false,
          status: 409,
          error: `${resolved.assignment.name} has approved time off on ${conflict.scheduledDate} and cannot take this assignment.`,
        };
      }

      const offDay = await staffIsOffOnDate(
        resolved.assignment.uid,
        conflict.scheduledDate,
        businessId,
      );
      if (offDay) {
        return {
          ok: false,
          status: 409,
          error: `${resolved.assignment.name} is not scheduled to work on ${conflict.scheduledDate} and cannot take this assignment.`,
        };
      }
    }

    if (conflict.kind === "job") {
      const result = await assignBusinessBooking(
        businessId,
        conflict.id,
        resolved.assignment,
      );
      if (!result.ok) return result;
    } else {
      const result = await applyOwnerAction(
        conflict.id,
        businessId,
        { type: "assign", assignment: resolved.assignment },
        {
          actor: {
            uid: reviewerUid,
            role: "owner",
            name: null,
            email: reviewerEmail ?? null,
          },
          source: "admin_panel",
        },
      );
      if (!result.ok) return result;
    }
  }

  return { ok: true };
}

/** Staff may request leave even when assigned; admin must reassign before approving. */
export async function createStaffLeaveRequest(
  staffUid: string,
  businessId: string,
  input: CreateStaffLeaveInput,
): Promise<CreateStaffLeaveResult> {
  const fromDate = input.fromDate.trim();
  const toDate = (input.toDate ?? input.fromDate).trim();
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || toDate < fromDate) {
    return {
      ok: false,
      status: 400,
      error: "Choose valid leave dates.",
    };
  }

  const fromMillis = parseYmdToMillis(fromDate);
  const toMillis = parseYmdToMillis(toDate);
  if (fromMillis == null || toMillis == null) {
    return { ok: false, status: 400, error: "Choose valid leave dates." };
  }

  const staffSnap = await adminDb.collection("users").doc(staffUid).get();
  if (!staffSnap.exists) {
    return { ok: false, status: 403, error: "Staff account not found." };
  }
  const staffData = staffSnap.data() ?? {};
  if (staffData.businessId !== businessId || staffData.role !== "staff") {
    return { ok: false, status: 403, error: "Staff account not found." };
  }

  const ownerUid = await resolveBusinessOwnerUid(businessId);
  const draft: LeaveRequestRecord = {
    id: "draft",
    businessId,
    ownerUid,
    requesterUid: staffUid,
    requesterName:
      typeof staffData.fullName === "string" && staffData.fullName.trim()
        ? staffData.fullName.trim()
        : "Team member",
    requesterRole: "staff",
    fromDate,
    toDate,
    fromMillis,
    toMillis,
    isFullDay: input.isFullDay !== false,
    startTime: trimOrNull(input.startTime),
    endTime: trimOrNull(input.endTime),
    reason: trimOrNull(input.reason),
    attachmentUrl: trimOrNull(input.attachmentUrl),
    status: "pending",
    rejectionReason: null,
    createdAtIso: null,
    createdAtMillis: null,
  };

  const conflicts = await findLeaveAssignmentConflicts(draft);

  const ref = adminDb.collection(LEAVE_COLLECTION).doc();
  await ref.set({
    businessId,
    ownerUid,
    requesterUid: staffUid,
    requesterName: draft.requesterName,
    requesterRole: "staff",
    fromDate: Timestamp.fromMillis(fromMillis),
    toDate: Timestamp.fromMillis(toMillis),
    isFullDay: draft.isFullDay,
    startTime: draft.startTime,
    endTime: draft.endTime,
    reason: draft.reason,
    attachmentUrl: draft.attachmentUrl,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const leave = mapLeaveDoc(ref.id, (await ref.get()).data() ?? {});
  void notifyBusinessOfStaffLeaveRequest(leave, conflicts);
  return { ok: true, leave };
}

/** Approve or reject a leave request, scoped to the owner's business. */
export async function decideLeaveRequest(
  leaveId: string,
  businessId: string,
  decision: {
    action: "approve" | "reject";
    reason?: string;
    reviewerUid?: string;
    reviewerEmail?: string;
    reassignments?: LeaveReassignment[];
  },
): Promise<LeaveDecisionResult> {
  const ref = adminDb.collection(LEAVE_COLLECTION).doc(leaveId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Leave request not found." };
  }
  const data = snap.data() ?? {};
  if (trimOrNull(data.businessId) !== businessId) {
    return { ok: false, status: 404, error: "Leave request not found." };
  }

  const current = mapLeaveDoc(snap.id, data);
  if (current.status !== "pending") {
    return {
      ok: false,
      status: 400,
      error: "This leave request has already been reviewed.",
    };
  }

  if (decision.action === "reject") {
    const reason = (decision.reason ?? "").trim();
    if (reason.length < 2) {
      return {
        ok: false,
        status: 400,
        error: "Add a short reason so the team member understands.",
      };
    }
    await ref.update({
      status: "rejected",
      rejectionReason: reason,
      reviewedByUid: decision.reviewerUid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    const conflicts = await findLeaveAssignmentConflicts(current);
    if (conflicts.length > 0) {
      const reassignments = decision.reassignments ?? [];
      if (reassignments.length === 0) {
        return {
          ok: false,
          status: 409,
          error: `${current.requesterName} is assigned to ${conflicts.length} scheduled job${conflicts.length === 1 ? "" : "s"} or visit${conflicts.length === 1 ? "" : "s"} during this leave. Reassign them before approving.`,
        };
      }

      const applied = await applyLeaveReassignments(
        businessId,
        conflicts,
        reassignments,
        decision.reviewerUid ?? "",
        decision.reviewerEmail,
      );
      if (!applied.ok) return applied;

      const remaining = await findLeaveAssignmentConflicts(current);
      if (remaining.length > 0) {
        return {
          ok: false,
          status: 409,
          error:
            "Some scheduled assignments still conflict with this leave. Reassign all jobs and visits before approving.",
        };
      }
    }

    await ref.update({
      status: "approved",
      rejectionReason: FieldValue.delete(),
      reviewedByUid: decision.reviewerUid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const updated = await ref.get();
  return { ok: true, leave: mapLeaveDoc(updated.id, updated.data() ?? {}) };
}

export { findLeaveAssignmentConflicts };
