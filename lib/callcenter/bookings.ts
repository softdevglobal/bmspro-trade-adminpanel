import "server-only";

import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import type { CallCenterTenantAuth } from "@/lib/callcenter/tenant";
import { chunk } from "@/lib/callcenter/tenant";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc, sortInspectionRequestsNewestFirst } from "@/lib/inspection/map-inspection-doc";
import { getRequestDocument } from "@/lib/inspection/request-document";
import { applyOwnerAction, type InspectionActionActor } from "@/lib/inspection/server";
import { clockToMinutes, staffAssignmentBlockMessage } from "@/lib/inspection/staff-assignment-block";
import {
  REQUEST_STATUSES,
  REQUESTS_COLLECTION,
  STATUS_LABELS,
  isClockTime,
  isFutureOrTodayDate,
  isIsoDate,
  isTimeRange,
  timeRangeFromStartTime,
  type InspectionAssignment,
  type InspectionRequestDetail,
  type InspectionRequestStatus,
  type InspectionSlot,
} from "@/lib/inspection/types";

/**
 * Call-center "bookings" on Trade are inspection requests (`requests`
 * collection). An agent creates one with POST /api/call-center/bookings, then
 * can confirm (schedule), reschedule, cancel or complete it here.
 */

type Failure = { ok: false; status: number; error: string; extra?: Record<string, unknown> };

export type CallCenterBookingRow = InspectionRequestDetail & { statusLabel: string };

export function serializeBooking(detail: InspectionRequestDetail): CallCenterBookingRow {
  return { ...detail, statusLabel: STATUS_LABELS[detail.status] ?? detail.status };
}

function auditFor(auth: CallCenterTenantAuth): InspectionActionActor {
  return { actor: auth.actor, source: "system" };
}

// ─── lookup ──────────────────────────────────────────────────────────────────

/** Finds a request by document id or by `requestCode` (e.g. `INS-REQ 4K7H2M9P`). */
export async function findBookingForBusiness(
  idOrCode: string,
  businessId: string,
): Promise<{ ok: true; snap: DocumentSnapshot; booking: InspectionRequestDetail } | Failure> {
  const key = idOrCode.trim();
  if (!key) return { ok: false, status: 400, error: "Missing booking id." };

  let snap: DocumentSnapshot | null = /^[^/]{1,128}$/.test(key) && ![".", ".."].includes(key)
    ? await getRequestDocument(key)
    : null;

  if (!snap) {
    const byCode = await adminDb
      .collection(REQUESTS_COLLECTION)
      .where("businessId", "==", businessId)
      .where("requestCode", "==", key)
      .limit(2)
      .get();
    if (byCode.size > 1) {
      return { ok: false, status: 409, error: "Multiple bookings match this request code." };
    }
    snap = byCode.docs[0] ?? null;
  }

  const data = snap?.data();
  // A booking from another business is reported as not found (no leaking).
  if (!snap || !data || data.businessId !== businessId) {
    return { ok: false, status: 404, error: "Booking not found." };
  }
  return { ok: true, snap, booking: mapInspectionDoc(snap.id, data) };
}

// ─── list ────────────────────────────────────────────────────────────────────

export type BookingListFilters = {
  status?: string;
  date?: string;
  phone?: string;
  createdSource?: string;
  limit: number;
};

const digits = (value: string) => value.replace(/\D/g, "");

export async function listBookingsForBusinesses(
  businessIds: string[],
  filters: BookingListFilters,
): Promise<CallCenterBookingRow[]> {
  if (businessIds.length === 0) return [];
  const readLimit = Math.min(Math.max(filters.limit * 3, 200), 1000);
  const snaps = await Promise.all(
    chunk(businessIds).map((ids) =>
      adminDb.collection(REQUESTS_COLLECTION).where("businessId", "in", ids).limit(readLimit).get(),
    ),
  );
  const phone = filters.phone ? digits(filters.phone).slice(-9) : "";
  const rows = snaps
    .flatMap((s) => s.docs.map((doc) => mapInspectionDoc(doc.id, doc.data() ?? {})))
    .filter((r) => !filters.status || r.status === filters.status)
    .filter((r) => !filters.createdSource || r.createdSource === filters.createdSource)
    .filter((r) => !phone || digits(r.customer.phone).endsWith(phone))
    .filter((r) => {
      if (!filters.date) return true;
      const slots = [r.scheduledSlot, ...r.preferredSlots, ...r.ownerProposedSlots];
      return slots.some((slot) => slot?.date === filters.date);
    });
  return sortInspectionRequestsNewestFirst(rows).slice(0, filters.limit).map(serializeBooking);
}

export function isRequestStatus(value: string): value is InspectionRequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function addMinutes(clock: string, minutes: number): string | null {
  const start = clockToMinutes(clock);
  if (start === null) return null;
  const end = start + minutes;
  if (end >= 24 * 60) return null;
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

function durationOf(booking: InspectionRequestDetail): number {
  const start = clockToMinutes(booking.scheduledStartTime);
  const end = clockToMinutes(booking.scheduledEndTime);
  return start !== null && end !== null && end > start ? end - start : 60;
}

async function resolveStaff(
  businessId: string,
  staffId: string,
): Promise<InspectionAssignment | null> {
  const snap = await adminDb.collection("users").doc(staffId).get();
  const data = snap.data();
  if (!data || data.businessId !== businessId || data.role !== "staff") return null;
  if (["inactive", "disabled", "suspended"].includes(String(data.status))) return null;
  return {
    type: "staff",
    uid: snap.id,
    name: typeof data.fullName === "string" ? data.fullName : "Staff member",
    email: typeof data.email === "string" ? data.email : null,
  };
}

/** Parses the visit window; `endTime` defaults to start + `durationMinutes`. */
function parseVisit(
  date: string,
  startTime: string,
  endTimeRaw: string,
  durationMinutes: number,
  timeRangeRaw: unknown,
  timeZone: string,
): { ok: true; slot: InspectionSlot; startTime: string; endTime: string } | Failure {
  if (!isIsoDate(date)) return { ok: false, status: 400, error: "date must be YYYY-MM-DD." };
  if (!isFutureOrTodayDate(date, timeZone)) {
    return { ok: false, status: 400, error: "The visit date cannot be in the past." };
  }
  if (!isClockTime(startTime)) return { ok: false, status: 400, error: "startTime must be HH:mm." };
  const endTime = endTimeRaw || addMinutes(startTime, durationMinutes) || "";
  if (!isClockTime(endTime) || endTime <= startTime) {
    return { ok: false, status: 400, error: "endTime must be HH:mm and after startTime." };
  }
  const timeRange = isTimeRange(timeRangeRaw) ? timeRangeRaw : timeRangeFromStartTime(startTime);
  return { ok: true, slot: { date, timeRange }, startTime, endTime };
}

async function staffForVisit(
  auth: CallCenterTenantAuth,
  bookingId: string,
  staffId: string,
  date: string,
  startTime: string,
  endTime: string,
): Promise<{ ok: true; assignment: InspectionAssignment } | Failure> {
  const assignment = await resolveStaff(auth.businessId, staffId);
  if (!assignment) {
    return { ok: false, status: 400, error: "Selected staff member is unavailable for this business." };
  }
  const blocked = await staffAssignmentBlockMessage(
    auth.businessId, assignment, date,
    clockToMinutes(startTime), clockToMinutes(endTime), "request", bookingId,
  );
  if (blocked) return { ok: false, status: 409, error: blocked };
  return { ok: true, assignment };
}

/** Appends an entry to `callCenterActions` on the request (who did what, when). */
async function recordCallCenterAction(
  snap: DocumentSnapshot,
  auth: CallCenterTenantAuth,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await snap.ref.update({
      callCenterActions: FieldValue.arrayUnion({
        action,
        byUid: auth.uid,
        byName: auth.name ?? null,
        byEmail: auth.email ?? null,
        isAi: auth.isAi,
        at: Timestamp.now(),
        ...details,
      }),
    });
  } catch (error) {
    console.error("[call-center-bookings] Could not record action", { action, error });
  }
}

export type StatusAction = "confirm" | "cancel" | "complete";

export type StatusChangeResult =
  | {
      ok: true;
      body: {
        ok: true;
        bookingId: string;
        requestCode: string | null;
        previousStatus: InspectionRequestStatus;
        status: InspectionRequestStatus;
        action: StatusAction;
        booking: CallCenterBookingRow;
      };
    }
  | Failure;

// ─── confirm / cancel / complete ─────────────────────────────────────────────

/**
 * confirm  → schedules the visit (`pending` / `owner_proposed` → `scheduled`).
 *            Body: `{ date?, startTime, endTime?, durationMinutes?, timeRange?, staffId?, note? }`.
 *            `date` defaults to the customer's first preferred (or proposed) day.
 * cancel   → `{ reason? }`.
 * complete → Trade only completes a visit once a quotation is saved, so this
 *            returns the business rule error unless the request allows it.
 */
export async function changeBookingStatus(
  auth: CallCenterTenantAuth,
  idOrCode: string,
  action: StatusAction,
  body: Record<string, unknown>,
): Promise<StatusChangeResult> {
  const found = await findBookingForBusiness(idOrCode, auth.businessId);
  if (!found.ok) return found;
  const { snap, booking } = found;
  const previousStatus = booking.status;
  const label = STATUS_LABELS[previousStatus] ?? previousStatus;
  const audit = auditFor(auth);
  let result: Awaited<ReturnType<typeof applyOwnerAction>>;

  if (action === "confirm") {
    if (previousStatus === "scheduled") {
      return { ok: false, status: 409, error: "Booking is already scheduled. Use reschedule to change it." };
    }
    if (previousStatus !== "pending" && previousStatus !== "owner_proposed") {
      return { ok: false, status: 400, error: `Cannot confirm a booking that is currently ${label}.` };
    }
    const fallback = previousStatus === "owner_proposed"
      ? booking.ownerProposedSlots[0] ?? booking.preferredSlots[0]
      : booking.preferredSlots[0];
    const date = str(body.date) || fallback?.date || "";
    const startTime = str(body.startTime) || str(body.time);
    const duration = typeof body.durationMinutes === "number" ? body.durationMinutes : 60;
    const visit = parseVisit(date, startTime, str(body.endTime), duration, body.timeRange, auth.timeZone);
    if (!visit.ok) return visit;

    const staffId = str(body.staffId);
    let assignment: InspectionAssignment | null = null;
    if (staffId) {
      const staff = await staffForVisit(auth, snap.id, staffId, visit.slot.date, visit.startTime, visit.endTime);
      if (!staff.ok) return staff;
      assignment = staff.assignment;
    }

    result = await applyOwnerAction(snap.id, auth.businessId, {
      type: "accept", slot: visit.slot, startTime: visit.startTime, endTime: visit.endTime,
      ...(str(body.note) ? { note: str(body.note) } : {}),
    }, audit);
    if (result.ok && assignment) {
      result = await applyOwnerAction(snap.id, auth.businessId, { type: "assign", assignment }, audit);
    }
  } else if (action === "cancel") {
    if (previousStatus === "cancelled") return { ok: false, status: 409, error: "Booking is already cancelled." };
    if (previousStatus === "completed") {
      return { ok: false, status: 400, error: `Cannot cancel a booking that is currently ${label}.` };
    }
    const reason = str(body.reason) || str(body.note);
    result = await applyOwnerAction(snap.id, auth.businessId, {
      type: "cancel", ...(reason ? { note: reason } : {}),
    }, audit);
  } else {
    if (previousStatus === "completed") return { ok: false, status: 409, error: "Booking is already completed." };
    if (previousStatus === "cancelled") {
      return { ok: false, status: 400, error: `Cannot complete a booking that is currently ${label}.` };
    }
    result = await applyOwnerAction(snap.id, auth.businessId, {
      type: "complete", ...(str(body.note) ? { note: str(body.note) } : {}),
    }, audit);
  }

  if (!result.ok) return { ok: false, status: result.status, error: result.error };
  await recordCallCenterAction(snap, auth, action, {
    previousStatus,
    ...(action === "cancel" && (str(body.reason) || str(body.note)) ? { reason: str(body.reason) || str(body.note) } : {}),
  });
  return {
    ok: true,
    body: {
      ok: true,
      bookingId: snap.id,
      requestCode: result.request.requestCode,
      previousStatus,
      status: result.request.status,
      action,
      booking: serializeBooking(result.request),
    },
  };
}

/** Maps a PATCH `{ status }` value to a status action (Trade or Pink spelling). */
export function statusToAction(status: string): StatusAction | null {
  const key = status.trim().toLowerCase();
  if (key === "scheduled" || key === "confirmed") return "confirm";
  if (key === "cancelled" || key === "canceled") return "cancel";
  if (key === "completed") return "complete";
  return null;
}

// ─── reschedule ──────────────────────────────────────────────────────────────

/**
 * Body: `{ newDate, newTime (or newStartTime), newEndTime?, timeRange?, reason?, newStaffId? }`.
 * End time defaults to the current visit length (60 min when not scheduled yet).
 */
export async function rescheduleBooking(
  auth: CallCenterTenantAuth,
  idOrCode: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; body: Record<string, unknown> } | Failure> {
  const newDate = str(body.newDate);
  const newTime = str(body.newTime) || str(body.newStartTime);
  if (!newDate || !newTime) {
    return { ok: false, status: 400, error: "newDate (YYYY-MM-DD) and newTime (HH:mm) are required." };
  }

  const found = await findBookingForBusiness(idOrCode, auth.businessId);
  if (!found.ok) return found;
  const { snap, booking } = found;
  if (booking.status === "cancelled" || booking.status === "completed") {
    return { ok: false, status: 400, error: `Cannot reschedule a ${booking.status} booking.` };
  }
  if (booking.status === "awaiting_decision" || booking.visitStartedAt) {
    return {
      ok: false, status: 409,
      error: "This visit has already been started by staff and can no longer be rescheduled. Cancel it instead.",
    };
  }

  const visit = parseVisit(newDate, newTime, str(body.newEndTime), durationOf(booking), body.timeRange, auth.timeZone);
  if (!visit.ok) return visit;

  const newStaffId = str(body.newStaffId);
  const sameStaff = !newStaffId || newStaffId === booking.assignedTo?.uid;
  if (
    booking.status === "scheduled" && sameStaff &&
    booking.scheduledSlot?.date === visit.slot.date &&
    booking.scheduledStartTime === visit.startTime &&
    booking.scheduledEndTime === visit.endTime
  ) {
    return { ok: false, status: 400, error: "The new date, time and staff are the same as the current booking." };
  }

  // The kept or new staff member must be free on the new day.
  let assignment: InspectionAssignment | null = null;
  if (newStaffId) {
    const staff = await staffForVisit(auth, snap.id, newStaffId, visit.slot.date, visit.startTime, visit.endTime);
    if (!staff.ok) return staff;
    assignment = staff.assignment;
  } else if (booking.assignedTo?.type === "staff") {
    const blocked = await staffAssignmentBlockMessage(
      auth.businessId, booking.assignedTo, visit.slot.date,
      clockToMinutes(visit.startTime), clockToMinutes(visit.endTime), "request", snap.id,
    );
    if (blocked) return { ok: false, status: 409, error: `${blocked} Pass newStaffId to reassign.` };
  }

  const audit = auditFor(auth);
  let result = await applyOwnerAction(snap.id, auth.businessId, {
    type: "accept", slot: visit.slot, startTime: visit.startTime, endTime: visit.endTime,
  }, audit);
  if (result.ok && assignment && !sameStaff) {
    result = await applyOwnerAction(snap.id, auth.businessId, { type: "assign", assignment }, audit);
  }
  if (!result.ok) return { ok: false, status: result.status, error: result.error };

  const previous = {
    date: booking.scheduledSlot?.date ?? null,
    startTime: booking.scheduledStartTime,
    endTime: booking.scheduledEndTime,
    staffId: booking.assignedTo?.uid ?? null,
    staffName: booking.assignedTo?.name ?? null,
  };
  await recordCallCenterAction(snap, auth, "reschedule", {
    from: previous,
    to: { date: visit.slot.date, startTime: visit.startTime, endTime: visit.endTime },
    reason: str(body.reason) || null,
  });

  const updated = result.request;
  return {
    ok: true,
    body: {
      ok: true,
      bookingId: snap.id,
      requestCode: updated.requestCode,
      status: updated.status,
      date: updated.scheduledSlot?.date ?? visit.slot.date,
      startTime: updated.scheduledStartTime,
      endTime: updated.scheduledEndTime,
      staffId: updated.assignedTo?.uid ?? null,
      staffName: updated.assignedTo?.name ?? null,
      previous,
      booking: serializeBooking(updated),
    },
  };
}
