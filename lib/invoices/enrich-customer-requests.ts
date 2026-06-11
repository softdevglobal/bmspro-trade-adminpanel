import "server-only";

import { JOBS_COLLECTION } from "@/lib/bookings/types";
import { adminDb } from "@/lib/firebase/admin";
import type {
  InspectionAssignment,
  InspectionInvoiceSummary,
  InspectionRequestDetail,
} from "@/lib/inspection/types";

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
    status: data.status === "sent" ? "sent" : data.status === "draft" ? "draft" : null,
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
    if (mirrored?.pdfUrl && mirrored.status === "sent") {
      return request;
    }
    return { ...request, invoice: fromDoc };
  });
}

/** Loads who is assigned on the linked job document (may differ from visit inspector). */
export async function enrichRequestsWithJobAssignees<
  T extends InspectionRequestDetail,
>(
  requests: T[],
): Promise<(T & { jobAssignedTo: InspectionAssignment | null })[]> {
  const withJob = requests.filter((request) => request.bookingId?.trim());
  if (withJob.length === 0) {
    return requests.map((request) => ({ ...request, jobAssignedTo: null }));
  }

  const refs = withJob.map((request) =>
    adminDb.collection(JOBS_COLLECTION).doc(request.bookingId!.trim()),
  );
  const snaps = await adminDb.getAll(...refs);
  const assigneeByBookingId = new Map(
    snaps
      .filter((snap) => snap.exists)
      .map(
        (snap) =>
          [
            snap.id,
            parseAssignment((snap.data() ?? {}).assignedTo),
          ] as const,
      ),
  );

  return requests.map((request) => {
    const bookingId = request.bookingId?.trim();
    if (!bookingId) return { ...request, jobAssignedTo: null };
    return {
      ...request,
      jobAssignedTo: assigneeByBookingId.get(bookingId) ?? null,
    };
  });
}
