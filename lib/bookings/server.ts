import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import {
  BOOKING_COLLECTION,
  type BookingDetail,
} from "@/lib/bookings/types";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { INSPECTION_COLLECTION } from "@/lib/inspection/types";
import type {
  InspectionAddress,
  InspectionAssignment,
  InspectionCustomer,
  InspectionRequestDetail,
  InspectionSlot,
} from "@/lib/inspection/types";
import { allocateBookingCode } from "@/lib/reference-codes.server";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid } from "@/lib/notifications/push";
import { notifyCustomerOfBookingOnTheWay } from "@/lib/notifications/server";
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
  assignedTo?: InspectionAssignment | null;
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
  const ownerUid = await resolveBusinessOwnerUid(current.businessId);

  const bookingPayload: Record<string, unknown> = {
    businessId: current.businessId,
    ownerUid: ownerUid ?? null,
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
    assignedTo: input.assignedTo ?? null,
    ownerNote: typeof input.note === "string" ? input.note : null,
    quotation: current.quotation,
    createdAt: now,
    updatedAt: now,
  };

  const inspectionUpdates: Record<string, unknown> = {
    bookingId: bookingRef.id,
    bookingCode,
    bookingStatus: "scheduled",
    bookingStatusAt: now,
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

  await mirrorBookingToQuotations(current.id, {
    bookingId: bookingRef.id,
    bookingCode,
    bookingStatus: "scheduled",
    bookingStatusAt: now,
  });

  return {
    ok: true,
    booking: mapBookingDoc(bookingRef.id, bookingSnap.data() ?? {}),
    request: mapInspectionDoc(requestSnap.id, requestSnap.data() ?? {}),
  };
}

/** Mirrors booking fields onto all quotations for an inspection visit. */
export async function mirrorBookingToQuotations(
  inspectionRequestId: string,
  fields: {
    bookingStatus: BookingStatus;
    bookingStatusAt?: ReturnType<typeof FieldValue.serverTimestamp>;
    bookingId?: string | null;
    bookingCode?: string | null;
  },
): Promise<void> {
  const snap = await adminDb
    .collection(QUOTATION_COLLECTION)
    .where("inspectionRequestId", "==", inspectionRequestId)
    .get();
  if (snap.empty) return;

  const statusAt =
    fields.bookingStatusAt ?? FieldValue.serverTimestamp();

  const update: Record<string, unknown> = {
    bookingStatus: fields.bookingStatus,
    bookingStatusAt: statusAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (fields.bookingId) update.bookingId = fields.bookingId;
  if (fields.bookingCode) update.bookingCode = fields.bookingCode;

  const batch = adminDb.batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, update);
  }
  await batch.commit();
}

async function mirrorBookingStatusToInspection(
  inspectionRequestId: string,
  bookingStatus: BookingStatus,
  fields: {
    bookingId?: string | null;
    bookingCode?: string | null;
  } = {},
): Promise<void> {
  const ref = adminDb.collection(INSPECTION_COLLECTION).doc(inspectionRequestId);
  const snap = await ref.get();
  if (!snap.exists) return;

  const update: Record<string, unknown> = {
    bookingStatus,
    bookingStatusAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (fields.bookingId) update.bookingId = fields.bookingId;
  if (fields.bookingCode) update.bookingCode = fields.bookingCode;
  await ref.update(update);
}

export async function assignBusinessBooking(
  businessId: string,
  bookingId: string,
  assignment: InspectionAssignment,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(BOOKING_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 403, error: "Booking not found." };
  }

  if (current.status !== "scheduled") {
    return {
      ok: false,
      status: 400,
      error: "Only scheduled bookings can be assigned.",
    };
  }

  await ref.update({
    assignedTo: assignment,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await ref.get();
  return {
    ok: true,
    booking: mapBookingDoc(updated.id, updated.data() ?? {}),
  };
}

async function loadBusinessSummary(businessId: string): Promise<{
  businessName: string | null;
  bookingSlug: string | null;
  logoUrl: string | null;
}> {
  try {
    const snap = await adminDb.collection("businesses").doc(businessId).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    return {
      businessName:
        typeof data.businessName === "string" ? data.businessName : null,
      bookingSlug:
        typeof data.bookingSlug === "string" ? data.bookingSlug : null,
      logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
    };
  } catch {
    return { businessName: null, bookingSlug: null, logoUrl: null };
  }
}

export async function startBusinessBookingVisit(
  bookingId: string,
  businessId: string,
  operatorUid: string,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(BOOKING_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  if (current.status !== "scheduled") {
    return {
      ok: false,
      status: 400,
      error: "Only scheduled bookings can be started.",
    };
  }

  const assignedUid = current.assignedTo?.uid;
  if (!assignedUid || assignedUid !== operatorUid) {
    return {
      ok: false,
      status: 403,
      error: "This job is not assigned to you.",
    };
  }

  if (current.visitStartedAt) {
    return { ok: true, booking: current };
  }

  await ref.update({
    visitStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await ref.get();
  const booking = mapBookingDoc(updated.id, updated.data() ?? {});
  const summary = await loadBusinessSummary(businessId);
  await notifyCustomerOfBookingOnTheWay(booking, summary);

  return { ok: true, booking };
}

export async function startBusinessBookingJob(
  bookingId: string,
  businessId: string,
  operatorUid: string,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(BOOKING_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  if (current.status === "ongoing") {
    return { ok: true, booking: current };
  }

  if (current.status !== "scheduled") {
    return {
      ok: false,
      status: 400,
      error: "Only scheduled bookings can be started.",
    };
  }

  const assignedUid = current.assignedTo?.uid;
  if (!assignedUid || assignedUid !== operatorUid) {
    return {
      ok: false,
      status: 403,
      error: "This job is not assigned to you.",
    };
  }

  if (!current.visitStartedAt) {
    return {
      ok: false,
      status: 400,
      error: "Start the visit before starting the booking.",
    };
  }

  await ref.update({
    bookingStartedAt:
      current.bookingStartedAt ?? FieldValue.serverTimestamp(),
    status: "ongoing",
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (current.inspectionRequestId) {
    await Promise.all([
      mirrorBookingToQuotations(current.inspectionRequestId, {
        bookingStatus: "ongoing",
        bookingId: current.id,
        bookingCode: current.bookingCode,
      }),
      mirrorBookingStatusToInspection(current.inspectionRequestId, "ongoing", {
        bookingId: current.id,
        bookingCode: current.bookingCode,
      }),
    ]);
  }

  const updated = await ref.get();
  return {
    ok: true,
    booking: mapBookingDoc(updated.id, updated.data() ?? {}),
  };
}

/**
 * Marks the booking for an inspection visit as completed when an invoice is
 * issued. If no booking exists yet, a completed booking is created so the job
 * still shows in the bookings table. Mirrors the status to the quotation and
 * inspection visit.
 */
export async function completeBookingForInvoicedQuotation(input: {
  businessId: string;
  inspectionRequestId: string;
  quotation: {
    id: string;
    quotationCode: string | null;
    serviceTitle: string;
    customer: InspectionCustomer;
    address: InspectionAddress;
    finalPriceAud: number;
    subtotalAud: number;
    balanceDueAud: number;
    status: string | null;
  };
}): Promise<{
  bookingId: string;
  bookingCode: string | null;
  bookingStatus: BookingStatus;
} | null> {
  const { businessId, inspectionRequestId, quotation } = input;
  const now = FieldValue.serverTimestamp();

  // 1) Existing booking linked to this inspection visit → mark completed.
  if (inspectionRequestId) {
    const existing = await adminDb
      .collection(BOOKING_COLLECTION)
      .where("businessId", "==", businessId)
      .where("inspectionRequestId", "==", inspectionRequestId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0]!;
      const current = mapBookingDoc(doc.id, doc.data() ?? {});
      if (current.status !== "completed") {
        await doc.ref.update({ status: "completed", updatedAt: now });
      }
      await Promise.all([
        mirrorBookingToQuotations(inspectionRequestId, {
          bookingStatus: "completed",
          bookingId: current.id,
          bookingCode: current.bookingCode,
        }),
        mirrorBookingStatusToInspection(inspectionRequestId, "completed", {
          bookingId: current.id,
          bookingCode: current.bookingCode,
        }),
      ]);
      return {
        bookingId: current.id,
        bookingCode: current.bookingCode,
        bookingStatus: "completed",
      };
    }
  }

  // 2) No booking yet → create a completed one from the quotation data.
  let requestType: InspectionRequestDetail["requestType"] = "custom_quote";
  let serviceId: string | null = null;
  let serviceName: string | null = null;
  let serviceBusinessType: string | null = null;
  let customRequest: { title: string; description: string } | null = null;
  let customerId: string | null = null;
  let inspectionRequestCode: string | null = null;

  if (inspectionRequestId) {
    const inspectionSnap = await adminDb
      .collection(INSPECTION_COLLECTION)
      .doc(inspectionRequestId)
      .get();
    if (inspectionSnap.exists) {
      const inspection = mapInspectionDoc(
        inspectionSnap.id,
        inspectionSnap.data() ?? {},
      );
      requestType = inspection.requestType;
      serviceId = inspection.serviceId;
      serviceName = inspection.serviceName;
      serviceBusinessType = inspection.serviceBusinessType;
      customRequest = inspection.customRequest;
      customerId = inspection.customerId;
      inspectionRequestCode = inspection.requestCode;
    }
  }

  const bookingCode = await allocateBookingCode();
  const bookingRef = adminDb.collection(BOOKING_COLLECTION).doc();
  const ownerUid = await resolveBusinessOwnerUid(businessId);

  const bookingPayload: Record<string, unknown> = {
    businessId,
    ownerUid: ownerUid ?? null,
    bookingCode,
    inspectionRequestId: inspectionRequestId || null,
    inspectionRequestCode,
    quotationId: quotation.id,
    status: "completed",
    requestType,
    serviceId,
    serviceName: serviceName ?? quotation.serviceTitle,
    serviceBusinessType,
    customRequest,
    customer: quotation.customer,
    customerId,
    address: quotation.address,
    scheduledSlot: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    estimatedDurationMinutes: null,
    assignedTo: null,
    ownerNote: null,
    quotation: {
      id: quotation.id,
      quotationCode: quotation.quotationCode,
      pdfUrl: null,
      finalPriceAud: quotation.finalPriceAud,
      subtotalAud: quotation.subtotalAud,
      balanceDueAud: quotation.balanceDueAud,
      status: quotation.status,
      createdAt: null,
    },
    completedFromInvoice: true,
    createdAt: now,
    updatedAt: now,
  };

  await bookingRef.set(bookingPayload);

  if (inspectionRequestId) {
    await Promise.all([
      mirrorBookingToQuotations(inspectionRequestId, {
        bookingStatus: "completed",
        bookingId: bookingRef.id,
        bookingCode,
      }),
      mirrorBookingStatusToInspection(inspectionRequestId, "completed", {
        bookingId: bookingRef.id,
        bookingCode,
      }),
    ]);
  }

  return {
    bookingId: bookingRef.id,
    bookingCode,
    bookingStatus: "completed",
  };
}

export async function completeBusinessBooking(
  bookingId: string,
  businessId: string,
  operatorUid: string,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(BOOKING_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Booking not found." };
  }

  if (current.status === "completed") {
    return { ok: true, booking: current };
  }

  const canComplete =
    current.status === "ongoing" ||
    (current.status === "scheduled" && current.bookingStartedAt);
  if (!canComplete) {
    return {
      ok: false,
      status: 400,
      error: "Only ongoing bookings can be completed.",
    };
  }

  const assignedUid = current.assignedTo?.uid;
  if (!assignedUid || assignedUid !== operatorUid) {
    return {
      ok: false,
      status: 403,
      error: "This job is not assigned to you.",
    };
  }

  await ref.update({
    status: "completed",
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (current.inspectionRequestId) {
    await Promise.all([
      mirrorBookingToQuotations(current.inspectionRequestId, {
        bookingStatus: "completed",
        bookingId: current.id,
        bookingCode: current.bookingCode,
      }),
      mirrorBookingStatusToInspection(
        current.inspectionRequestId,
        "completed",
        {
          bookingId: current.id,
          bookingCode: current.bookingCode,
        },
      ),
    ]);
  }

  const updated = await ref.get();
  return {
    ok: true,
    booking: mapBookingDoc(updated.id, updated.data() ?? {}),
  };
}
