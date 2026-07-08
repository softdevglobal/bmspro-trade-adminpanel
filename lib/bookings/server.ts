import "server-only";

import { mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import {
  JOBS_COLLECTION,
  type BookingDetail,
} from "@/lib/bookings/types";
import type {
  InspectionAddress,
  InspectionAssignment,
  InspectionCustomer,
  InspectionRequestDetail,
  InspectionRequestType,
  InspectionSlot,
} from "@/lib/inspection/types";
import {
  REQUESTS_COLLECTION,
} from "@/lib/inspection/types";
import { logAuditEvent } from "@/lib/audit/server";
import type { AuditActor, AuditSource } from "@/lib/audit/types";
import {
  computeDaySlotOccupancy,
  rangeOverlapsFullSlots,
} from "@/lib/calendar/slot-occupancy";
import { isBusinessClosedOnDate } from "@/lib/calendar/business-closures/server";
import { allocateBookingCode } from "@/lib/reference-codes.server";
import { buildQuotationCodeForInspection } from "@/lib/reference-codes";
import { allocateInspectionRequestCode } from "@/lib/reference-codes.server";
import { getRequestDocumentRef } from "@/lib/inspection/request-document";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import {
  QUOTATION_COLLECTION,
  serializeLineItemsForFirestore,
} from "@/lib/quotations/server";
import type { QuotationLineItem } from "@/lib/quotations/types";
import { ensureCustomerAccount } from "@/lib/customer/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  notifyCustomerOfBookingOnTheWay,
  notifyCustomerOfJobCompleted,
  notifyCustomerOfJobScheduled,
  notifyCustomerOfJobRescheduled,
} from "@/lib/notifications/server";
import { resolveBusinessOwnerUid } from "@/lib/notifications/push";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { sortBookingsNewestFirst } from "@/lib/bookings/map-booking-doc";
import type { BookingStatus } from "@/lib/bookings/types";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";

export const BOOKING_LIST_LIMIT = 80;

export type CreateBookingInput = {
  inspectionRequestId: string;
  businessId: string;
  slot: InspectionSlot;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
  note?: string;
  instructionDescription?: string;
  instructionTasks?: string[];
  assignedTo?: InspectionAssignment | null;
};

export async function getBusinessBooking(
  businessId: string,
  bookingId: string,
): Promise<BookingDetail | null> {
  const snap = await adminDb.collection(JOBS_COLLECTION).doc(bookingId).get();
  if (!snap.exists) return null;
  const booking = mapBookingDoc(snap.id, snap.data() ?? {});
  if (booking.businessId !== businessId) return null;
  return booking;
}

export async function listBusinessBookings(
  businessId: string,
): Promise<BookingDetail[]> {
  const snapshot = await adminDb
    .collection(JOBS_COLLECTION)
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
    .collection(REQUESTS_COLLECTION)
    .doc(input.inspectionRequestId);
  const inspectionSnap = await inspectionRef.get();
  if (!inspectionSnap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
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

  if (current.quotation.customerDecision !== "accepted") {
    return {
      ok: false,
      status: 400,
      error:
        current.quotation.customerDecision === "rejected"
          ? "The customer rejected this quotation, so it cannot become a job."
          : "Wait for the customer to accept the quotation before creating a job.",
    };
  }

  if (current.bookingId) {
    return {
      ok: false,
      status: 400,
      error: "A booking already exists for this request.",
    };
  }

  if (await isBusinessClosedOnDate(input.businessId, input.slot.date)) {
    return {
      ok: false,
      status: 400,
      error:
        "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
    };
  }

  const occupancy = await computeDaySlotOccupancy(
    input.businessId,
    input.slot.date,
  );
  if (
    rangeOverlapsFullSlots(
      occupancy.slots,
      input.startTime,
      input.endTime,
      "job",
    )
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "One or more time slots in that range are full for jobs. Choose another time or update capacity in Settings.",
    };
  }

  const bookingCode = await allocateBookingCode();
  const bookingRef = adminDb.collection(JOBS_COLLECTION).doc();
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
    jobInstructionsDescription:
      typeof input.instructionDescription === "string"
        ? input.instructionDescription
        : null,
    jobInstructionsTasks: input.instructionTasks ?? [],
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

/** Mirrors booking fields onto all quotations for an request. */
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
  const ref = adminDb.collection(REQUESTS_COLLECTION).doc(inspectionRequestId);
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
  const ref = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 403, error: "Job not found." };
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

/**
 * Reschedules a scheduled/ongoing job to a new date + time window. Re-checks
 * business closures and per-hour job capacity so the move respects the same
 * rules as creating a job. The schedule reminder cron reads the updated
 * `scheduledStartTime`, so reminders automatically follow the new time.
 */
export async function updateBusinessBookingSchedule(
  businessId: string,
  bookingId: string,
  input: { slot: InspectionSlot; startTime: string; endTime: string },
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 403, error: "Job not found." };
  }

  if (current.status !== "scheduled" && current.status !== "ongoing") {
    return {
      ok: false,
      status: 400,
      error: "Only scheduled or in-progress jobs can be rescheduled.",
    };
  }

  if (await isBusinessClosedOnDate(businessId, input.slot.date)) {
    return {
      ok: false,
      status: 400,
      error:
        "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
    };
  }

  const occupancy = await computeDaySlotOccupancy(businessId, input.slot.date, {
    excludeBookingId: bookingId,
  });
  if (
    rangeOverlapsFullSlots(occupancy.slots, input.startTime, input.endTime, "job")
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "One or more time slots in that range are full for jobs. Choose another time or update capacity in Settings.",
    };
  }

  await ref.update({
    scheduledSlot: input.slot,
    scheduledStartTime: input.startTime,
    scheduledEndTime: input.endTime,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await ref.get();
  const booking = mapBookingDoc(updated.id, updated.data() ?? {});

  // Tell the customer (in-portal + email + SMS) that their job moved.
  const summary = await loadBusinessSummary(businessId);
  await notifyCustomerOfJobRescheduled(booking, summary);

  return {
    ok: true,
    booking,
  };
}

async function loadBusinessSummary(businessId: string): Promise<{
  businessName: string | null;
  bookingSlug: string | null;
  logoUrl: string | null;
  timezone: string;
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
      timezone:
        typeof data.timezone === "string" && data.timezone.trim()
          ? data.timezone.trim()
          : PLATFORM_TIME_ZONE,
    };
  } catch {
    return {
      businessName: null,
      bookingSlug: null,
      logoUrl: null,
      timezone: PLATFORM_TIME_ZONE,
    };
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
  const ref = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
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
  const ref = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
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
    visitEndedAt:
      current.visitEndedAt ?? FieldValue.serverTimestamp(),
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

async function resolveBookingProgressBackfill(
  current: BookingDetail,
  inspectionRequestId?: string | null,
): Promise<Record<string, unknown>> {
  const updates: Record<string, unknown> = {};
  let visitStartedAt = current.visitStartedAt;
  let visitEndedAt = current.visitEndedAt;
  const bookingStartedAt = current.bookingStartedAt;

  const requestId = inspectionRequestId ?? current.inspectionRequestId;
  if ((!visitStartedAt || !visitEndedAt) && requestId) {
    const inspectionSnap = await adminDb
      .collection(REQUESTS_COLLECTION)
      .doc(requestId)
      .get();
    if (inspectionSnap.exists) {
      const inspection = mapInspectionDoc(
        inspectionSnap.id,
        inspectionSnap.data() ?? {},
      );
      visitStartedAt = visitStartedAt ?? inspection.visitStartedAt;
      visitEndedAt = visitEndedAt ?? inspection.visitEndedAt;
    }
  }

  if (!visitStartedAt) {
    updates.visitStartedAt = FieldValue.serverTimestamp();
  } else if (!current.visitStartedAt) {
    updates.visitStartedAt = Timestamp.fromMillis(visitStartedAt);
  }

  if (!visitEndedAt) {
    updates.visitEndedAt = FieldValue.serverTimestamp();
  } else if (!current.visitEndedAt) {
    updates.visitEndedAt = Timestamp.fromMillis(visitEndedAt);
  }

  if (!bookingStartedAt) {
    updates.bookingStartedAt = FieldValue.serverTimestamp();
  } else if (!current.bookingStartedAt) {
    updates.bookingStartedAt = Timestamp.fromMillis(bookingStartedAt);
  }

  return updates;
}

export type InvoicedBookingAudit = {
  actor: AuditActor;
  source: AuditSource;
  invoiceCode?: string | null;
  quotationCode?: string | null;
};

/**
 * Marks the booking for an request as completed when an invoice is
 * issued. If no booking exists yet, a completed booking is created so the job
 * still shows in the bookings table. Mirrors the status to the quotation and
 * request.
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
  audit?: InvoicedBookingAudit;
}): Promise<{
  bookingId: string;
  bookingCode: string | null;
  bookingStatus: BookingStatus;
} | null> {
  const { businessId, inspectionRequestId, quotation } = input;
  const now = FieldValue.serverTimestamp();

  // 1) Existing booking linked to this request → mark completed.
  if (inspectionRequestId) {
    const existing = await adminDb
      .collection(JOBS_COLLECTION)
      .where("businessId", "==", businessId)
      .where("inspectionRequestId", "==", inspectionRequestId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0]!;
      const current = mapBookingDoc(doc.id, doc.data() ?? {});
      const completedNow = current.status !== "completed";
      if (completedNow) {
        const progressUpdates = await resolveBookingProgressBackfill(
          current,
          inspectionRequestId,
        );
        await doc.ref.update({
          status: "completed",
          updatedAt: now,
          ...progressUpdates,
        });
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
      if (completedNow && input.audit) {
        const bookingLabel = current.bookingCode ?? current.id;
        const invoiceLabel = input.audit.invoiceCode?.trim();
        await logAuditEvent({
          businessId,
          category: "invoice",
          action: "invoice.booking_completed",
          actor: input.audit.actor,
          source: input.audit.source,
          summary: invoiceLabel
            ? `Booking ${bookingLabel} completed when invoice ${invoiceLabel} was issued`
            : `Booking ${bookingLabel} completed when an invoice was issued`,
          targetId: current.id,
          targetLabel: invoiceLabel || current.bookingCode || null,
          metadata: {
            origin: "invoice",
            invoiceCode: input.audit.invoiceCode ?? null,
            bookingCode: current.bookingCode ?? null,
            bookingId: current.id,
            quotationCode: input.audit.quotationCode ?? null,
            inspectionRequestId,
          },
        });
      }
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
  let inspectionVisitStartedAt: number | null = null;
  let inspectionVisitEndedAt: number | null = null;

  if (inspectionRequestId) {
    const inspectionSnap = await adminDb
      .collection(REQUESTS_COLLECTION)
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
      inspectionVisitStartedAt = inspection.visitStartedAt;
      inspectionVisitEndedAt = inspection.visitEndedAt;
    }
  }

  const bookingCode = await allocateBookingCode();
  const bookingRef = adminDb.collection(JOBS_COLLECTION).doc();
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
    visitStartedAt:
      inspectionVisitStartedAt != null
        ? Timestamp.fromMillis(inspectionVisitStartedAt)
        : now,
    visitEndedAt:
      inspectionVisitEndedAt != null
        ? Timestamp.fromMillis(inspectionVisitEndedAt)
        : now,
    bookingStartedAt: now,
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

  if (input.audit) {
    const invoiceLabel = input.audit.invoiceCode?.trim();
    await logAuditEvent({
      businessId,
      category: "invoice",
      action: "invoice.booking_created",
      actor: input.audit.actor,
      source: input.audit.source,
      summary: invoiceLabel
        ? `Booking ${bookingCode} created when invoice ${invoiceLabel} was issued`
        : `Booking ${bookingCode} created when an invoice was issued`,
      targetId: bookingRef.id,
      targetLabel: invoiceLabel || bookingCode || null,
      metadata: {
        origin: "invoice",
        completedFromInvoice: true,
        invoiceCode: input.audit.invoiceCode ?? null,
        bookingCode,
        bookingId: bookingRef.id,
        quotationCode: input.audit.quotationCode ?? null,
        inspectionRequestId: inspectionRequestId || null,
        quotationId: quotation.id,
      },
    });
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
  options?: {
    beforeImageUrls?: string[];
    afterImageUrls?: string[];
  },
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
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

  const progressUpdates = await resolveBookingProgressBackfill(current);

  await ref.update({
    status: "completed",
    ...progressUpdates,
    ...(options?.beforeImageUrls?.length
      ? { beforeImageUrls: options.beforeImageUrls.slice(0, 5) }
      : {}),
    ...(options?.afterImageUrls?.length
      ? { afterImageUrls: options.afterImageUrls.slice(0, 5) }
      : {}),
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
  const booking = mapBookingDoc(updated.id, updated.data() ?? {});
  const summary = await loadBusinessSummary(businessId);
  await notifyCustomerOfJobCompleted(booking, summary);

  return {
    ok: true,
    booking,
  };
}

function normalizeCompletionPhotoUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    .map((url) => url.trim())
    .slice(0, 5);
}

export async function updateBookingCompletionPhotos(
  bookingId: string,
  businessId: string,
  operatorUid: string,
  input: {
    beforeImageUrls?: unknown;
    afterImageUrls?: unknown;
  },
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const ref = adminDb.collection(JOBS_COLLECTION).doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  if (current.status !== "ongoing" && current.status !== "completed") {
    return {
      ok: false,
      status: 400,
      error: "Photos can only be added while the job is in progress or completed.",
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

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.beforeImageUrls !== undefined) {
    update.beforeImageUrls = normalizeCompletionPhotoUrls(input.beforeImageUrls);
  }
  if (input.afterImageUrls !== undefined) {
    update.afterImageUrls = normalizeCompletionPhotoUrls(input.afterImageUrls);
  }

  await ref.update(update);

  const updated = await ref.get();
  return {
    ok: true,
    booking: mapBookingDoc(updated.id, updated.data() ?? {}),
  };
}

export type CreateDirectJobInput = {
  requestType: InspectionRequestType;
  serviceId: string | null;
  customRequest: { title: string; description: string } | null;
  customer: InspectionCustomer;
  address: InspectionAddress;
  customerNotes: string | null;
  budgetAud: number | null;
  slot: InspectionSlot;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
  additionalJobDays?: InspectionSlot[];
  note?: string | null;
  instructionDescription?: string | null;
  instructionTasks?: string[];
  assignedTo?: InspectionAssignment | null;
};

async function lookupBusinessServiceForJob(
  businessId: string,
  serviceId: string,
): Promise<{ name: string; businessType: string } | null> {
  const snap = await adminDb.collection(COLLECTIONS.SERVICES).doc(serviceId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || data.businessId !== businessId) return null;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const businessType =
    typeof data.businessType === "string"
      ? data.businessType
      : typeof data.category === "string"
        ? data.category
        : "";
  return name ? { name, businessType } : null;
}

/**
 * Creates a scheduled job directly (no prior inspection/quote flow). A
 * completed request (`job_direct`), sent + accepted quotation, and scheduled
 * booking are created so downstream steps (invoice, completion) work normally.
 */
export async function createDirectJob(
  businessId: string,
  createdBy: string,
  input: CreateDirectJobInput,
  audit?: { actor: AuditActor; source: AuditSource },
): Promise<
  | { ok: true; booking: BookingDetail; request: InspectionRequestDetail }
  | { ok: false; status: number; error: string }
> {
  if (await isBusinessClosedOnDate(businessId, input.slot.date)) {
    return {
      ok: false,
      status: 400,
      error:
        "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
    };
  }

  const occupancy = await computeDaySlotOccupancy(businessId, input.slot.date);
  if (
    rangeOverlapsFullSlots(
      occupancy.slots,
      input.startTime,
      input.endTime,
      "job",
    )
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "One or more time slots in that range are full for jobs. Choose another time or update capacity in Settings.",
    };
  }

  let serviceName: string | null = null;
  let serviceBusinessType: string | null = null;
  let serviceId: string | null = input.serviceId;
  let customRequest = input.customRequest;
  let quotationTitle = "";

  if (input.requestType === "existing_service") {
    const sid = input.serviceId?.trim() ?? "";
    if (!sid) {
      return { ok: false, status: 400, error: "Select a service from the list." };
    }
    const service = await lookupBusinessServiceForJob(businessId, sid);
    if (!service) {
      return {
        ok: false,
        status: 400,
        error: "Selected service is no longer available.",
      };
    }
    serviceName = service.name;
    serviceBusinessType = service.businessType;
    quotationTitle = service.name;
  } else {
    const title = customRequest?.title?.trim() ?? "";
    const description = customRequest?.description?.trim() ?? "";
    if (title.length < 3) {
      return {
        ok: false,
        status: 400,
        error: "Add a job title (at least 3 characters).",
      };
    }
    if (description.length < 10) {
      return {
        ok: false,
        status: 400,
        error: "Describe the work needed (at least 10 characters).",
      };
    }
    customRequest = { title, description };
    serviceId = null;
    quotationTitle = title;
  }

  const priceAud =
    typeof input.budgetAud === "number" &&
    Number.isFinite(input.budgetAud) &&
    input.budgetAud >= 0
      ? input.budgetAud
      : 0;
  const lineItems: QuotationLineItem[] = [
    {
      name: quotationTitle,
      priceAud,
      quantity: 1,
      description:
        input.requestType === "custom_quote"
          ? (customRequest?.description ?? "Agreed work")
          : "Agreed work",
    },
  ];
  const subtotalAud = priceAud;
  const finalPriceAud = priceAud;
  const balanceDueAud = finalPriceAud;

  let customerId: string | null = null;
  try {
    const businessSnap = await adminDb.collection("businesses").doc(businessId).get();
    const businessData = businessSnap.data() ?? {};
    const account = await ensureCustomerAccount({
      email: input.customer.email,
      fullName: input.customer.fullName,
      phone: input.customer.phone,
      businessId,
      businessName:
        typeof businessData.businessName === "string"
          ? businessData.businessName
          : null,
      bookingSlug:
        typeof businessData.bookingSlug === "string"
          ? businessData.bookingSlug
          : null,
      logoUrl:
        typeof businessData.logoUrl === "string" ? businessData.logoUrl : null,
      context: "inspection",
    });
    customerId = account.uid;
  } catch (error) {
    console.error("[direct-job] customer account creation failed:", error);
  }

  const now = FieldValue.serverTimestamp();
  const inspectionRef = adminDb.collection(REQUESTS_COLLECTION).doc();
  const quotationRef = adminDb.collection(QUOTATION_COLLECTION).doc();
  const bookingRef = adminDb.collection(JOBS_COLLECTION).doc();
  const requestCode = await allocateInspectionRequestCode();
  const quotationCode = buildQuotationCodeForInspection({
    id: inspectionRef.id,
    requestCode,
  });
  const bookingCode = await allocateBookingCode();
  const ownerUid = await resolveBusinessOwnerUid(businessId);

  const quotationSummary = {
    id: quotationRef.id,
    quotationCode,
    finalPriceAud,
    subtotalAud,
    balanceDueAud,
    pdfUrl: null,
    status: "sent",
    customerDecision: "accepted",
    customerDecisionAt: now,
    createdAt: now,
  };

  const inspectionPayload: Record<string, unknown> = {
    id: inspectionRef.id,
    businessId,
    requestCode,
    status: "completed",
    requestType: input.requestType,
    serviceId,
    serviceName,
    serviceBusinessType,
    customRequest,
    customer: input.customer,
    customerId,
    createdSource: "job_direct",
    address: input.address,
    preferredSlots: [],
    ownerProposedSlots: [],
    adminJobPreferredSlots: input.additionalJobDays ?? [],
    jobProposedSlots: input.additionalJobDays ?? [],
    scheduledSlot: input.slot,
    scheduledStartTime: input.startTime,
    scheduledEndTime: input.endTime,
    assignedTo: input.assignedTo ?? null,
    ownerNote: typeof input.note === "string" ? input.note : null,
    customerNotes: input.customerNotes,
    budgetAud: input.budgetAud,
    quotation: quotationSummary,
    bookingId: bookingRef.id,
    bookingCode,
    bookingStatus: "scheduled",
    bookingStatusAt: now,
    bookingConfirmedAt: now,
    visitStartedAt: now,
    visitEndedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const quotationPayload: Record<string, unknown> = {
    quotationCode,
    businessId,
    inspectionRequestId: inspectionRef.id,
    serviceTitle: quotationTitle,
    serviceDescription:
      input.requestType === "custom_quote"
        ? (customRequest?.description ?? null)
        : null,
    customer: input.customer,
    address: input.address,
    lineItems: serializeLineItemsForFirestore(lineItems),
    subtotalAud,
    finalPriceAud,
    balanceDueAud,
    imageUrls: [],
    notes: input.customerNotes,
    paymentInstructions: null,
    termsAndConditions: null,
    discountAud: 0,
    depositRequest: null,
    validUntil: null,
    status: "sent",
    customerDecision: "accepted",
    customerDecisionAt: now,
    bookingId: bookingRef.id,
    bookingCode,
    bookingStatus: "scheduled",
    bookingStatusAt: now,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };

  const bookingPayload: Record<string, unknown> = {
    businessId,
    ownerUid: ownerUid ?? null,
    bookingCode,
    inspectionRequestId: inspectionRef.id,
    inspectionRequestCode: requestCode,
    quotationId: quotationRef.id,
    status: "scheduled",
    requestType: input.requestType,
    serviceId,
    serviceName,
    serviceBusinessType,
    customRequest,
    customer: input.customer,
    customerId,
    address: input.address,
    scheduledSlot: input.slot,
    scheduledStartTime: input.startTime,
    scheduledEndTime: input.endTime,
    additionalJobDays: input.additionalJobDays ?? [],
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    assignedTo: input.assignedTo ?? null,
    ownerNote: typeof input.note === "string" ? input.note : null,
    jobInstructionsDescription:
      typeof input.instructionDescription === "string"
        ? input.instructionDescription
        : null,
    jobInstructionsTasks: input.instructionTasks ?? [],
    quotation: quotationSummary,
    createdAt: now,
    updatedAt: now,
  };

  await adminDb.runTransaction(async (transaction) => {
    transaction.set(inspectionRef, inspectionPayload);
    transaction.set(quotationRef, quotationPayload);
    transaction.set(bookingRef, bookingPayload);
  });

  const [bookingSnap, requestSnap] = await Promise.all([
    bookingRef.get(),
    inspectionRef.get(),
  ]);

  const booking = mapBookingDoc(bookingRef.id, bookingSnap.data() ?? {});
  const request = mapInspectionDoc(requestSnap.id, requestSnap.data() ?? {});

  const summary = await loadBusinessSummary(businessId);
  try {
    await notifyCustomerOfJobScheduled(booking, summary);
  } catch (error) {
    console.error("[direct-job] customer notification failed:", error);
  }

  if (audit) {
    await logAuditEvent({
      businessId,
      category: "booking",
      action: "booking.created",
      actor: audit.actor,
      source: audit.source,
      summary: `Job ${booking.bookingCode ?? booking.id} created directly (inspection and quotation marked complete)`,
      targetId: booking.id,
      targetLabel:
        booking.bookingCode ||
        booking.serviceName ||
        booking.customer.fullName ||
        null,
      metadata: {
        origin: "direct",
        inspectionId: request.id,
        bookingCode: booking.bookingCode ?? null,
        requestCode: request.requestCode ?? null,
      },
    });
  }

  return { ok: true, booking, request };
}

async function clearBookingMirrors(
  businessId: string,
  inspectionRequestId: string,
  bookingId: string,
): Promise<void> {
  const requestRef = await getRequestDocumentRef(inspectionRequestId);
  if (requestRef) {
    const requestSnap = await requestRef.get();
    if (requestSnap.exists) {
      const requestData = requestSnap.data() ?? {};
      if (
        requestData.businessId === businessId &&
        requestData.bookingId === bookingId
      ) {
        await requestRef.update({
          bookingId: FieldValue.delete(),
          bookingCode: FieldValue.delete(),
          bookingStatus: FieldValue.delete(),
          bookingStatusAt: FieldValue.delete(),
          bookingConfirmedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }

  const quotationSnap = await adminDb
    .collection(QUOTATION_COLLECTION)
    .where("inspectionRequestId", "==", inspectionRequestId)
    .get();
  if (quotationSnap.empty) return;

  const batch = adminDb.batch();
  for (const doc of quotationSnap.docs) {
    const quotationData = doc.data();
    if (
      quotationData.businessId === businessId &&
      quotationData.bookingId === bookingId
    ) {
      batch.update(doc.ref, {
        bookingId: FieldValue.delete(),
        bookingCode: FieldValue.delete(),
        bookingStatus: FieldValue.delete(),
        bookingStatusAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
}

/** Permanently removes a job and clears its mirrors on the linked request. */
export async function deleteBusinessBooking(
  businessId: string,
  bookingId: string,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const id = bookingId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Job is required." };
  }

  const ref = adminDb.collection(JOBS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const booking = mapBookingDoc(snap.id, snap.data() ?? {});
  if (booking.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  await ref.delete();

  const requestId = booking.inspectionRequestId?.trim();
  if (requestId) {
    try {
      await clearBookingMirrors(businessId, requestId, id);
    } catch (error) {
      console.error("[booking] request cleanup failed:", error);
    }
  }

  return { ok: true, booking };
}

/**
 * Cancels a job (booking) without deleting it. The record is kept for
 * reference and its `cancelled` status is mirrored onto the linked request
 * and quotations. Completed jobs cannot be cancelled.
 */
export async function cancelBusinessBooking(
  businessId: string,
  bookingId: string,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const id = bookingId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Job is required." };
  }

  const ref = adminDb.collection(JOBS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const current = mapBookingDoc(snap.id, snap.data() ?? {});
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  if (current.status === "cancelled") {
    return { ok: true, booking: current };
  }
  if (current.status === "completed") {
    return {
      ok: false,
      status: 400,
      error: "Completed jobs cannot be cancelled.",
    };
  }

  await ref.update({
    status: "cancelled",
    // Remember the pre-cancellation status so it can be restored on undo.
    cancelledFromStatus: current.status,
    cancelledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (current.inspectionRequestId) {
    await Promise.all([
      mirrorBookingToQuotations(current.inspectionRequestId, {
        bookingStatus: "cancelled",
        bookingId: current.id,
        bookingCode: current.bookingCode,
      }),
      mirrorBookingStatusToInspection(current.inspectionRequestId, "cancelled", {
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

const RESTORABLE_BOOKING_STATUSES: BookingStatus[] = [
  "awaiting",
  "scheduled",
  "ongoing",
];

/** Chooses the status a cancelled job returns to when its cancellation is undone. */
function resolveRestoredBookingStatus(
  data: Record<string, unknown>,
): BookingStatus {
  const from = data.cancelledFromStatus;
  if (
    typeof from === "string" &&
    RESTORABLE_BOOKING_STATUSES.includes(from as BookingStatus)
  ) {
    return from as BookingStatus;
  }
  return "scheduled";
}

/**
 * Restores a cancelled job to its pre-cancellation status and re-mirrors that
 * status onto the linked request and quotations.
 */
export async function undoCancelBusinessBooking(
  businessId: string,
  bookingId: string,
): Promise<
  | { ok: true; booking: BookingDetail }
  | { ok: false; status: number; error: string }
> {
  const id = bookingId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Job is required." };
  }

  const ref = adminDb.collection(JOBS_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  const data = snap.data() ?? {};
  const current = mapBookingDoc(snap.id, data);
  if (current.businessId !== businessId) {
    return { ok: false, status: 404, error: "Job not found." };
  }

  if (current.status !== "cancelled") {
    return {
      ok: false,
      status: 400,
      error: "Only cancelled jobs can be restored.",
    };
  }

  const restoredStatus = resolveRestoredBookingStatus(data);

  await ref.update({
    status: restoredStatus,
    cancelledAt: FieldValue.delete(),
    cancelledFromStatus: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (current.inspectionRequestId) {
    await Promise.all([
      mirrorBookingToQuotations(current.inspectionRequestId, {
        bookingStatus: restoredStatus,
        bookingId: current.id,
        bookingCode: current.bookingCode,
      }),
      mirrorBookingStatusToInspection(
        current.inspectionRequestId,
        restoredStatus,
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
