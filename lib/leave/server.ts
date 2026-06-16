import { adminDb } from "@/lib/firebase/admin";
import { platformTodayIso } from "@/lib/platform/timezone";
import type { LeaveRequestRecord, LeaveStatus } from "@/lib/leave/types";
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

function parseClockMinutes(raw: string | null): number | null {
  if (!raw) return null;
  const parts = raw.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = parts.length > 1 ? Number.parseInt(parts[1] ?? "", 10) : 0;
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
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
  const from = leave.fromDate;
  const to = leave.toDate ?? leave.fromDate;
  if (!from || !to) return false;
  if (ymd < from || ymd > to) return false;

  if (leave.isFullDay) return true;

  const start = parseClockMinutes(leave.startTime);
  const end = parseClockMinutes(leave.endTime);
  if (start == null || end == null || end <= start) return true;

  // No specific window requested → any overlap with the leave day counts.
  if (windowStartMinutes == null || windowEndMinutes == null) return true;

  return windowStartMinutes < end && start < windowEndMinutes;
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

export type LeaveDecisionResult =
  | { ok: true; leave: LeaveRequestRecord }
  | { ok: false; status: number; error: string };

/** Approve or reject a leave request, scoped to the owner's business. */
export async function decideLeaveRequest(
  leaveId: string,
  businessId: string,
  decision: { action: "approve" | "reject"; reason?: string; reviewerUid?: string },
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
