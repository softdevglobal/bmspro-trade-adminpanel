import "server-only";

import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import type {
  InspectionAssignment,
  InspectionInvoiceSummary,
  InspectionRequestDetail,
  InspectionSlot,
} from "@/lib/inspection/types";
import { isClockTime, isTimeRange } from "@/lib/inspection/types";

function parseSlot(raw: unknown): InspectionSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = typeof item.date === "string" ? item.date : null;
  const timeRange = item.timeRange;
  if (!date || !isTimeRange(timeRange)) return null;
  return { date, timeRange };
}

type JobDocumentEnrichment = {
  jobAssignedTo: InspectionAssignment | null;
  jobScheduledSlot: InspectionSlot | null;
  jobScheduledStartTime: string | null;
  jobScheduledEndTime: string | null;
};

function parseJobDocumentEnrichment(
  data: Record<string, unknown>,
): JobDocumentEnrichment {
  return {
    jobAssignedTo: parseAssignment(data.assignedTo),
    jobScheduledSlot: parseSlot(data.scheduledSlot),
    jobScheduledStartTime: isClockTime(data.scheduledStartTime)
      ? data.scheduledStartTime
      : null,
    jobScheduledEndTime: isClockTime(data.scheduledEndTime)
      ? data.scheduledEndTime
      : null,
  };
}

function parseAssignment(raw: unknown): InspectionAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const type = item.type === "owner" ? "owner" : "staff";
  const uid = typeof item.uid === "string" ? item.uid : "";
  const name = typeof item.name === "string" ? item.name : "";
  const email = typeof item.email === "string" ? item.email : null;
  if (!uid) return null;
  return { type, uid, name, email };
}

function invoiceSummaryFromDoc(
  quotationId: string,
  data: Record<string, unknown>,
): InspectionInvoiceSummary {
  const readPrice = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const pdfUrlRaw = typeof data.pdfUrl === "string" ? data.pdfUrl.trim() : "";

  return {
    id: quotationId,
    invoiceCode:
      typeof data.invoiceCode === "string" && data.invoiceCode.trim()
        ? data.invoiceCode.trim()
        : null,
    pdfUrl: pdfUrlRaw.length > 0 ? pdfUrlRaw : null,
    finalPriceAud: readPrice(data.finalPriceAud),
    balanceDueAud: readPrice(data.balanceDueAud),
    status:
      data.status === "paid"
        ? "paid"
        : data.status === "sent"
          ? "sent"
          : data.status === "draft"
            ? "draft"
            : null,
    invoiceDate:
      typeof data.invoiceDate === "string" && data.invoiceDate.trim()
        ? data.invoiceDate.trim()
        : null,
    dueDate:
      typeof data.dueDate === "string" && data.dueDate.trim()
        ? data.dueDate.trim()
        : null,
  };
}

/** Attaches linked invoice metadata for customer request history (invoice id = quotation id). */
export async function enrichRequestsWithInvoices(
  requests: InspectionRequestDetail[],
): Promise<InspectionRequestDetail[]> {
  const withQuotation = requests.filter((request) => request.quotation?.id);
  if (withQuotation.length === 0) return requests;

  const refs = withQuotation.map((request) =>
    adminDb.collection("invoices").doc(request.quotation!.id),
  );
  const snaps = await adminDb.getAll(...refs);
  const invoiceByQuotationId = new Map(
    snaps
      .filter((snap) => snap.exists)
      .map((snap) => [snap.id, snap.data() ?? {}] as const),
  );

  return requests.map((request) => {
    const quotationId = request.quotation?.id;
    if (!quotationId) return request;

    const mirrored = request.invoice;
    const fromCollection = invoiceByQuotationId.get(quotationId);
    if (!fromCollection && mirrored) return request;
    if (!fromCollection) return { ...request, invoice: null };

    const fromDoc = invoiceSummaryFromDoc(quotationId, fromCollection);
    if (
      mirrored?.pdfUrl &&
      (mirrored.status === "sent" || mirrored.status === "paid")
    ) {
      return request;
    }
    return { ...request, invoice: fromDoc };
  });
}

export type CustomerJobEnrichment = {
  jobAssignedTo: InspectionAssignment | null;
  jobScheduledSlot: InspectionSlot | null;
  jobScheduledStartTime: string | null;
  jobScheduledEndTime: string | null;
};

const EMPTY_JOB_ENRICHMENT: CustomerJobEnrichment = {
  jobAssignedTo: null,
  jobScheduledSlot: null,
  jobScheduledStartTime: null,
  jobScheduledEndTime: null,
};

/** Loads linked job schedule and assignee (may differ from the inspection visit). */
export async function enrichRequestsWithJobAssignees<
  T extends InspectionRequestDetail,
>(
  requests: T[],
): Promise<(T & CustomerJobEnrichment)[]> {
  const withJob = requests.filter((request) => request.bookingId?.trim());
  if (withJob.length === 0) {
    return requests.map((request) => ({ ...request, ...EMPTY_JOB_ENRICHMENT }));
  }

  const refs = withJob.map((request) =>
    adminDb.collection(JOBS_COLLECTION).doc(request.bookingId!.trim()),
  );
  const snaps = await adminDb.getAll(...refs);
  const jobByBookingId = new Map(
    snaps
      .filter((snap) => snap.exists)
      .map(
        (snap) =>
          [snap.id, parseJobDocumentEnrichment(snap.data() ?? {})] as const,
      ),
  );

  return requests.map((request) => {
    const bookingId = request.bookingId?.trim();
    if (!bookingId) return { ...request, ...EMPTY_JOB_ENRICHMENT };
    return {
      ...request,
      ...(jobByBookingId.get(bookingId) ?? EMPTY_JOB_ENRICHMENT),
    };
  });
}

/** Reads a staff/owner profile photo from the various legacy user doc fields. */
function userPhotoUrl(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  for (const key of ["photoUrl", "photoURL", "avatarUrl"]) {
    const value = data[key];
    if (
      typeof value === "string" &&
      (value.trim().startsWith("http://") ||
        value.trim().startsWith("https://"))
    ) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Attaches the uploaded profile photo of each assignee (`assignedTo` and
 * `jobAssignedTo`) so the customer portal can show who is coming. Photos are
 * read from the assignee's user document.
 */
export async function enrichAssignmentsWithPhotos<
  T extends {
    assignedTo: InspectionAssignment | null;
    jobAssignedTo?: InspectionAssignment | null;
  },
>(requests: T[]): Promise<T[]> {
  const uids = new Set<string>();
  for (const request of requests) {
    if (request.assignedTo?.uid) uids.add(request.assignedTo.uid);
    if (request.jobAssignedTo?.uid) uids.add(request.jobAssignedTo.uid);
  }
  if (uids.size === 0) return requests;

  const ids = Array.from(uids);
  const photoByUid = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const refs = chunk.map((id) => adminDb.collection("users").doc(id));
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      photoByUid.set(snap.id, snap.exists ? userPhotoUrl(snap.data()) : null);
    }
  }

  const withPhoto = (
    assignment: InspectionAssignment | null | undefined,
  ): InspectionAssignment | null => {
    if (!assignment) return assignment ?? null;
    const photoUrl = photoByUid.get(assignment.uid) ?? null;
    return { ...assignment, photoUrl };
  };

  return requests.map((request) => ({
    ...request,
    assignedTo: withPhoto(request.assignedTo),
    ...(request.jobAssignedTo !== undefined
      ? { jobAssignedTo: withPhoto(request.jobAssignedTo) }
      : {}),
  }));
}
