import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import {
  REQUESTS_COLLECTION,
  TIME_RANGE_SHORT_LABELS,
  TIME_RANGES,
  type InspectionSlot,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { parseClockMinutes } from "@/lib/leave/clock";
import { leaveOverlapsDay } from "@/lib/leave/conflicts";
import { listBusinessLeaveRequests } from "@/lib/leave/server";
import type { LeaveRequestRecord } from "@/lib/leave/types";
import { formatIsoDateInPlatformTimeZone } from "@/lib/platform/timezone";
import { resolveBusinessOwnerUid } from "@/lib/notifications/push";
import {
  isStaffOffOnDate,
  offDayIdsFromAvailability,
} from "@/lib/team/staff-availability";

export type UnavailableSlot = {
  date: string;
  timeRange: InspectionTimeRange;
};

export function timeRangeWindow(timeRange: InspectionTimeRange): {
  startTime: string;
  endTime: string;
} {
  return timeRange === "morning"
    ? { startTime: "08:00", endTime: "12:00" }
    : { startTime: "12:00", endTime: "17:00" };
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

type TeamMember = {
  uid: string;
  offDays: string[];
};

async function listAssignableTeamMembers(
  businessId: string,
): Promise<TeamMember[]> {
  const [ownerUid, usersSnap] = await Promise.all([
    resolveBusinessOwnerUid(businessId),
    adminDb.collection("users").where("businessId", "==", businessId).get(),
  ]);

  const members: TeamMember[] = [];
  const seen = new Set<string>();

  if (ownerUid) {
    const ownerDoc = usersSnap.docs.find((doc) => doc.id === ownerUid);
    members.push({
      uid: ownerUid,
      offDays: ownerDoc
        ? offDayIdsFromAvailability(ownerDoc.data()?.availability)
        : [],
    });
    seen.add(ownerUid);
  }

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (data.role !== "staff") continue;
    if (data.status === "suspended") continue;
    if (seen.has(doc.id)) continue;
    members.push({
      uid: doc.id,
      offDays: offDayIdsFromAvailability(data.availability),
    });
    seen.add(doc.id);
  }

  return members;
}

type BusyAssignment = {
  uid: string;
  date: string;
  timeRange: InspectionTimeRange;
};

async function loadBusyAssignments(
  businessId: string,
): Promise<BusyAssignment[]> {
  const [jobsSnap, requestsSnap] = await Promise.all([
    adminDb
      .collection(JOBS_COLLECTION)
      .where("businessId", "==", businessId)
      .get(),
    adminDb
      .collection(REQUESTS_COLLECTION)
      .where("businessId", "==", businessId)
      .get(),
  ]);

  const busy: BusyAssignment[] = [];

  for (const doc of jobsSnap.docs) {
    const booking = mapBookingDoc(doc.id, doc.data() ?? {});
    if (booking.status !== "scheduled" && booking.status !== "ongoing") {
      continue;
    }
    const uid = booking.assignedTo?.uid;
    const slot = booking.scheduledSlot;
    if (!uid || !slot?.date || !slot.timeRange) continue;
    busy.push({ uid, date: slot.date, timeRange: slot.timeRange });
  }

  for (const doc of requestsSnap.docs) {
    const request = mapInspectionDoc(doc.id, doc.data() ?? {});
    if (request.status !== "scheduled") continue;
    const uid = request.assignedTo?.uid;
    const slot = request.scheduledSlot;
    if (!uid || !slot?.date || !slot.timeRange) continue;
    busy.push({ uid, date: slot.date, timeRange: slot.timeRange });
  }

  return busy;
}

function memberAvailableForSlot(
  member: TeamMember,
  date: string,
  timeRange: InspectionTimeRange,
  timeZone: string,
  leaveRequests: LeaveRequestRecord[],
  busyAssignments: BusyAssignment[],
): boolean {
  if (isStaffOffOnDate(member.offDays, date, timeZone)) return false;

  const { startTime, endTime } = timeRangeWindow(timeRange);
  const startMin = parseClockMinutes(startTime);
  const endMin = parseClockMinutes(endTime);

  for (const leave of leaveRequests) {
    if (leave.requesterUid !== member.uid) continue;
    if (leave.status !== "approved" && leave.status !== "pending") continue;
    if (
      leaveOverlapsDay(
        leave,
        date,
        startMin ?? undefined,
        endMin ?? undefined,
      )
    ) {
      return false;
    }
  }

  for (const assignment of busyAssignments) {
    if (assignment.uid !== member.uid) continue;
    if (assignment.date === date && assignment.timeRange === timeRange) {
      return false;
    }
  }

  return true;
}

/** Slots where every assignable team member is busy, on leave, or off. */
export async function computeUnavailableSlots(
  businessId: string,
  fromDate: string,
  toDate: string,
  timeZone: string,
): Promise<UnavailableSlot[]> {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    return [];
  }

  const [members, leaveRequests, busyAssignments] = await Promise.all([
    listAssignableTeamMembers(businessId),
    listBusinessLeaveRequests(businessId),
    loadBusyAssignments(businessId),
  ]);

  const unavailable: UnavailableSlot[] = [];

  if (members.length === 0) {
    let cursor = fromDate;
    while (cursor <= toDate) {
      for (const timeRange of TIME_RANGES) {
        unavailable.push({ date: cursor, timeRange });
      }
      cursor = addDaysIso(cursor, 1);
    }
    return unavailable;
  }

  let cursor = fromDate;
  while (cursor <= toDate) {
    for (const timeRange of TIME_RANGES) {
      const anyoneAvailable = members.some((member) =>
        memberAvailableForSlot(
          member,
          cursor,
          timeRange,
          timeZone,
          leaveRequests,
          busyAssignments,
        ),
      );
      if (!anyoneAvailable) {
        unavailable.push({ date: cursor, timeRange });
      }
    }
    cursor = addDaysIso(cursor, 1);
  }

  return unavailable;
}

function formatUnavailableSlotMessage(
  slot: InspectionSlot,
  timeZone: string,
): string {
  const dateLabel = formatIsoDateInPlatformTimeZone(
    slot.date,
    { weekday: "short", month: "short", day: "numeric" },
    timeZone,
  );
  const timeLabel = TIME_RANGE_SHORT_LABELS[slot.timeRange].toLowerCase();
  return `${dateLabel} (${timeLabel}) is not available — all team members are busy or away. Please choose another date or time.`;
}

/** Rejects customer preferred slots when no one can be assigned. */
export async function validatePreferredSlotsAvailable(
  businessId: string,
  slots: InspectionSlot[],
  timeZone: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (slots.length === 0) return { ok: true };

  const dates = slots.map((slot) => slot.date).sort();
  const fromDate = dates[0]!;
  const toDate = dates[dates.length - 1]!;
  const unavailable = await computeUnavailableSlots(
    businessId,
    fromDate,
    toDate,
    timeZone,
  );
  const blocked = new Set(
    unavailable.map((slot) => `${slot.date}-${slot.timeRange}`),
  );

  for (const slot of slots) {
    if (blocked.has(`${slot.date}-${slot.timeRange}`)) {
      return {
        ok: false,
        error: formatUnavailableSlotMessage(slot, timeZone),
      };
    }
  }

  return { ok: true };
}
