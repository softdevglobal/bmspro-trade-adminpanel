import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import {
  BOOKING_COLLECTION,
  type BookingDetail,
} from "@/lib/bookings/types";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { INSPECTION_COLLECTION } from "@/lib/inspection/types";
import type {
  InspectionRequestDetail,
  InspectionSlot,
} from "@/lib/inspection/types";
import { allocateBookingCode } from "@/lib/reference-codes.server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { sortBookingsNewestFirst } from "@/lib/bookings/map-booking-doc";
import { QUOTATION_COLLECTION } from "@/lib/quotations/server";
import type { BookingStatus } from "@/lib/bookings/types";

export const BOOKING_LIST_LIMIT = 80;

export type CreateBookingInput = {
  inspectionRequestId: string;
  businessId: string;
  slot: InspectionSlot;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
  note?: string;
};

export async function getBusinessBooking(
  businessId: string,
  bookingId: string,
): Promise<BookingDetail | null> {
  const snap = await adminDb.collection(BOOKING_COLLECTION).doc(bookingId).get();
  if (!snap.exists) return null;
  const booking = mapBookingDoc(snap.id, snap.data() ?? {});
  if (booking.businessId !== businessId) return null;
  return booking;
}

export async function listBusinessBookings(
  businessId: string,
): Promise<BookingDetail[]> {
  const snapshot = await adminDb
    .collection(BOOKING_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(BOOKING_LIST_LIMIT)
    .get();

  const bookings = snapshot.docs.map((doc) =>
    mapBookingDoc(doc.id, doc.data() ?? {}),
  );
  return sortBookingsNewestFirst(bookings);
}

export async function createBookingFromInspection(
  input: CreateBookingInput,
): Promise<
  | { ok: true; booking: BookingDetail; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  const inspectionRef = adminDb
    .collection(INSPECTION_COLLECTION)
    .doc(input.inspectionRequestId);
  const inspectionSnap = await inspectionRef.get();
  if (!inspectionSnap.exists) {
    return { ok: false, status: 404, error: "Inspection request not found." };
  }

  const current = mapInspectionDoc(
    inspectionSnap.id,
    inspectionSnap.data() ?? {},
  );

  if (current.businessId !== input.businessId) {
    return { ok: false, status: 403, error: "Request not found." };
  }

  if (
    current.status !== "completed" &&
    current.status !== "awaiting_decision"
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "Only completed visits (or those awaiting decision) with a quotation can become a booking.",
    };
  }

  if (!current.quotation) {
    return {
      ok: false,
      status: 400,
      error: "Send a quotation before creating a booking.",
    };
  }

  if (current.bookingId) {
    return {
      ok: false,
      status: 400,
      error: "A booking already exists for this inspection visit.",
    };
  }

  const bookingCode = await allocateBookingCode();
  const bookingRef = adminDb.collection(BOOKING_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();

  const bookingPayload: Record<string, unknown> = {
    businessId: current.businessId,
    bookingCode,
    inspectionRequestId: current.id,
    inspectionRequestCode: current.requestCode,
    quotationId: current.quotation.id,
    status: "scheduled",
    requestType: current.requestType,
    serviceId: current.serviceId,
    serviceName: current.serviceName,
    serviceBusinessType: current.serviceBusinessType,
    customRequest: current.customRequest,
    customer: current.customer,
    customerId: current.customerId,
    address: current.address,
    scheduledSlot: input.slot,
    scheduledStartTime: input.startTime,
    scheduledEndTime: input.endTime,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    assignedTo: current.assignedTo,
    ownerNote: typeof input.note === "string" ? input.note : null,
    quotation: current.quotation,
    createdAt: now,
    updatedAt: now,
  };

  const inspectionUpdates: Record<string, unknown> = {
    bookingId: bookingRef.id,
    bookingCode,
    bookingStatus: "scheduled",
    bookingConfirmedAt: now,
    updatedAt: now,
  };

  if (current.status === "awaiting_decision") {
    inspectionUpdates.status = "completed";
  }

  if (typeof input.note === "string") {
    inspectionUpdates.ownerNote = input.note;
  }

  await adminDb.runTransaction(async (transaction) => {
    transaction.set(bookingRef, bookingPayload);
    transaction.update(inspectionRef, inspectionUpdates);
  });

  const [bookingSnap, requestSnap] = await Promise.all([
    bookingRef.get(),
    inspectionRef.get(),
  ]);

  await mirrorBookingToQuotations(current.id, bookingRef.id, bookingCode, "scheduled");

  return {
    ok: true,
    booking: mapBookingDoc(bookingRef.id, bookingSnap.data() ?? {}),
    request: mapInspectionDoc(requestSnap.id, requestSnap.data() ?? {}),
  };
}

async function mirrorBookingToQuotations(
  inspectionRequestId: string,
  bookingId: string,
  bookingCode: string,
  bookingStatus: BookingStatus,
): Promise<void> {
  const snap = await adminDb
    .collection(QUOTATION_COLLECTION)
    .where("inspectionRequestId", "==", inspectionRequestId)
    .get();
  if (snap.empty) return;

  const batch = adminDb.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      bookingId,
      bookingCode,
      bookingStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}
