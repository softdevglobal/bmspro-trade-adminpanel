import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { JOBS_COLLECTION } from "@/lib/bookings/types";
import {
  bookingTitle,
  requestTitle,
} from "@/lib/calendar/events";
import {
  BUSINESS_CLOSURES_COLLECTION,
  type BusinessClosure,
  type ClosureConflictItem,
} from "@/lib/calendar/business-closures/types";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import {
  formatVisitWindow,
  REQUESTS_COLLECTION,
  TIME_RANGE_SHORT_LABELS,
  TIME_RANGES,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import { displayBookingCode, displayInspectionRequestCode } from "@/lib/reference-codes";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function closureDocId(businessId: string, date: string): string {
  return `${businessId}__${date}`;
}

function mapClosureDoc(
  id: string,
  data: FirebaseFirestore.DocumentData,
): BusinessClosure {
  const createdAt =
    data.createdAt instanceof Timestamp
      ? data.createdAt.toDate().toISOString()
      : null;

  return {
    id,
    businessId: typeof data.businessId === "string" ? data.businessId : "",
    date: typeof data.date === "string" ? data.date : "",
    reason: typeof data.reason === "string" ? data.reason : null,
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : "",
    createdAt,
  };
}

function formatConflictTimeLabel(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  timeRange: InspectionTimeRange | undefined,
): string {
  const window = formatVisitWindow(startTime, endTime);
  if (window) return window;
  if (timeRange) return TIME_RANGE_SHORT_LABELS[timeRange];
  return "Time TBC";
}

export async function listBusinessClosuresInRange(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<BusinessClosure[]> {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    return [];
  }

  const snapshot = await adminDb
    .collection(BUSINESS_CLOSURES_COLLECTION)
    .where("businessId", "==", businessId)
    .get();

  return snapshot.docs
    .map((doc) => mapClosureDoc(doc.id, doc.data() ?? {}))
    .filter((closure) => closure.date >= fromDate && closure.date <= toDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getBusinessClosure(
  businessId: string,
  date: string,
): Promise<BusinessClosure | null> {
  if (!isIsoDate(date)) return null;
  const snap = await adminDb
    .collection(BUSINESS_CLOSURES_COLLECTION)
    .doc(closureDocId(businessId, date))
    .get();
  if (!snap.exists) return null;
  const closure = mapClosureDoc(snap.id, snap.data() ?? {});
  if (closure.businessId !== businessId) return null;
  return closure;
}

export async function isBusinessClosedOnDate(
  businessId: string,
  date: string,
): Promise<boolean> {
  const closure = await getBusinessClosure(businessId, date);
  return closure != null;
}

export async function loadClosureConflicts(
  businessId: string,
  date: string,
): Promise<ClosureConflictItem[]> {
  if (!isIsoDate(date)) return [];

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

  const conflicts: ClosureConflictItem[] = [];

  for (const doc of jobsSnap.docs) {
    const booking = mapBookingDoc(doc.id, doc.data() ?? {});
    if (booking.status !== "scheduled" && booking.status !== "ongoing") {
      continue;
    }
    if (booking.scheduledSlot?.date !== date) continue;

    conflicts.push({
      id: booking.id,
      kind: "job",
      title: bookingTitle(booking),
      customerName: booking.customer.fullName,
      customerPhone: booking.customer.phone ?? null,
      customerEmail: booking.customer.email ?? null,
      reference: displayBookingCode(booking),
      timeLabel: formatConflictTimeLabel(
        booking.scheduledStartTime,
        booking.scheduledEndTime,
        booking.scheduledSlot?.timeRange,
      ),
    });
  }

  for (const doc of requestsSnap.docs) {
    const request = mapInspectionDoc(doc.id, doc.data() ?? {});
    if (request.status !== "scheduled") continue;
    if (request.scheduledSlot?.date !== date) continue;

    conflicts.push({
      id: request.id,
      kind: "request",
      title: requestTitle(request),
      customerName: request.customer.fullName,
      customerPhone: request.customer.phone ?? null,
      customerEmail: request.customer.email ?? null,
      reference: displayInspectionRequestCode(request),
      timeLabel: formatConflictTimeLabel(
        request.scheduledStartTime,
        request.scheduledEndTime,
        request.scheduledSlot?.timeRange,
      ),
    });
  }

  return conflicts.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
}

export function closureUnavailableSlots(
  closures: readonly { date: string }[],
): { date: string; timeRange: InspectionTimeRange }[] {
  const unavailable: { date: string; timeRange: InspectionTimeRange }[] = [];
  for (const closure of closures) {
    for (const timeRange of TIME_RANGES) {
      unavailable.push({ date: closure.date, timeRange });
    }
  }
  return unavailable;
}

export async function createBusinessClosure(
  businessId: string,
  createdByUid: string,
  input: {
    date: string;
    reason: string | null;
    acknowledgedConflicts: boolean;
  },
): Promise<
  | { ok: true; closure: BusinessClosure; conflicts: ClosureConflictItem[] }
  | {
      ok: false;
      status: number;
      error: string;
      conflicts?: ClosureConflictItem[];
    }
> {
  if (!isIsoDate(input.date)) {
    return { ok: false, status: 400, error: "Enter a valid date." };
  }

  const existing = await getBusinessClosure(businessId, input.date);
  if (existing) {
    return {
      ok: false,
      status: 400,
      error: "This day is already marked as a business off day.",
    };
  }

  const conflicts = await loadClosureConflicts(businessId, input.date);
  if (conflicts.length > 0 && !input.acknowledgedConflicts) {
    return {
      ok: false,
      status: 409,
      error:
        "This day has scheduled jobs or inspection requests. Contact affected customers before marking it as an off day.",
      conflicts,
    };
  }

  const ref = adminDb
    .collection(BUSINESS_CLOSURES_COLLECTION)
    .doc(closureDocId(businessId, input.date));
  const now = FieldValue.serverTimestamp();

  await ref.set({
    businessId,
    date: input.date,
    reason: input.reason,
    createdByUid,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await ref.get();
  return {
    ok: true,
    closure: mapClosureDoc(ref.id, snap.data() ?? {}),
    conflicts,
  };
}

export async function deleteBusinessClosure(
  businessId: string,
  date: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isIsoDate(date)) {
    return { ok: false, status: 400, error: "Enter a valid date." };
  }

  const existing = await getBusinessClosure(businessId, date);
  if (!existing) {
    return { ok: false, status: 404, error: "This day is not marked as closed." };
  }

  await adminDb
    .collection(BUSINESS_CLOSURES_COLLECTION)
    .doc(closureDocId(businessId, date))
    .delete();

  return { ok: true };
}
