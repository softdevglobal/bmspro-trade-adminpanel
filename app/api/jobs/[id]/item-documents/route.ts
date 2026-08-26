import { getBusinessBooking } from "@/lib/bookings/server";
import { resolveItemDocumentsByName } from "@/lib/items/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import {
  getBusinessQuotationById,
  listQuotationsForInspection,
} from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Documents attached to the catalog items this job actually uses.
 *
 * Deliberately separate from `/api/quotations`: assigned staff must be able to
 * read an item's safety sheet on an ongoing job, but are blocked from quotation
 * pricing. This returns names and document URLs only — no prices, no totals —
 * so the pricing gate stays intact.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const jobId = id?.trim() ?? "";
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "Missing job id." },
      { status: 400 },
    );
  }

  const booking = await getBusinessBooking(auth.businessId, jobId);
  if (!booking) {
    return NextResponse.json(
      { ok: false, error: "Job not found." },
      { status: 404 },
    );
  }

  // Staff only get the documents for jobs they are actually on.
  if (auth.role === "staff" && booking.assignedTo?.uid !== auth.uid) {
    return NextResponse.json(
      { ok: false, error: "Job not found." },
      { status: 404 },
    );
  }

  const names = await jobItemNames(auth.businessId, booking);
  const documents = await resolveItemDocumentsByName(auth.businessId, names);

  return NextResponse.json({ ok: true, documents });
}

/**
 * Line item names for the job, falling back to the booked service or custom
 * request title when the job has no quotation behind it.
 */
async function jobItemNames(
  businessId: string,
  booking: Awaited<ReturnType<typeof getBusinessBooking>>,
): Promise<string[]> {
  if (!booking) return [];

  const quotationId = booking.quotationId ?? booking.quotation?.id ?? null;
  const quotation = quotationId
    ? await getBusinessQuotationById(businessId, quotationId)
    : booking.inspectionRequestId
      ? (
          await listQuotationsForInspection(
            businessId,
            booking.inspectionRequestId,
          )
        )[0]
      : null;

  if (quotation && quotation.lineItems.length > 0) {
    return quotation.lineItems.map((line) => line.name);
  }

  const fallback = booking.serviceName ?? booking.customRequest?.title ?? "";
  return fallback.trim() ? [fallback] : [];
}
