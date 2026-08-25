import {
  isRecurringJobAnchor,
  recurringVisitCount,
} from "@/lib/bookings/map-booking-doc";
import type { BookingDetail } from "@/lib/bookings/types";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import type { QuotationDetail } from "@/lib/quotations/types";

export function seriesKeyForBooking(
  booking: BookingDetail | null | undefined,
): string | null {
  if (!booking) return null;
  if (booking.seriesId) return booking.seriesId;
  if (booking.recurrence) return booking.id;
  return null;
}

export function seriesKeyForBookingId(
  bookingId: string | null | undefined,
  bookingById: ReadonlyMap<string, BookingDetail>,
): string | null {
  if (!bookingId) return null;
  return seriesKeyForBooking(bookingById.get(bookingId) ?? null);
}

function pickAnchorRequest(
  members: InspectionRequestDetail[],
  bookingById: ReadonlyMap<string, BookingDetail>,
): InspectionRequestDetail {
  const anchor = members.find((request) => {
    const booking = request.bookingId
      ? bookingById.get(request.bookingId)
      : null;
    return booking ? isRecurringJobAnchor(booking) : false;
  });
  return anchor ?? members[0]!;
}

/** One request card per repeating job series. */
export function uniqueRequestsForBoard(
  requests: InspectionRequestDetail[],
  bookingById: ReadonlyMap<string, BookingDetail>,
): InspectionRequestDetail[] {
  const seen = new Set<string>();
  const result: InspectionRequestDetail[] = [];

  for (const request of requests) {
    const seriesKey = seriesKeyForBookingId(request.bookingId, bookingById);
    if (!seriesKey) {
      result.push(request);
      continue;
    }
    if (seen.has(seriesKey)) continue;
    seen.add(seriesKey);

    const members = requests.filter(
      (item) => seriesKeyForBookingId(item.bookingId, bookingById) === seriesKey,
    );
    result.push(pickAnchorRequest(members, bookingById));
  }

  return result;
}

export function canonicalRequestId(
  requestId: string,
  requests: InspectionRequestDetail[],
  unique: InspectionRequestDetail[],
  bookingById: ReadonlyMap<string, BookingDetail>,
): string {
  const original = requests.find((request) => request.id === requestId);
  if (!original) return requestId;
  const seriesKey = seriesKeyForBookingId(original.bookingId, bookingById);
  if (!seriesKey) return requestId;
  const canonical = unique.find(
    (request) =>
      seriesKeyForBookingId(request.bookingId, bookingById) === seriesKey,
  );
  return canonical?.id ?? requestId;
}

function bookingIdForQuotation(
  quotation: QuotationDetail,
  requestById: ReadonlyMap<string, InspectionRequestDetail>,
): string | null {
  if (quotation.bookingId) return quotation.bookingId;
  return requestById.get(quotation.inspectionRequestId)?.bookingId ?? null;
}

/** One quotation card per repeating job series. */
export function uniqueQuotationsForBoard(
  quotations: QuotationDetail[],
  bookingById: ReadonlyMap<string, BookingDetail>,
  requestById: ReadonlyMap<string, InspectionRequestDetail>,
): QuotationDetail[] {
  const seen = new Set<string>();
  const result: QuotationDetail[] = [];

  for (const quotation of quotations) {
    const seriesKey = seriesKeyForBookingId(
      bookingIdForQuotation(quotation, requestById),
      bookingById,
    );
    if (!seriesKey) {
      result.push(quotation);
      continue;
    }
    if (seen.has(seriesKey)) continue;
    seen.add(seriesKey);

    const members = quotations.filter(
      (item) =>
        seriesKeyForBookingId(
          bookingIdForQuotation(item, requestById),
          bookingById,
        ) === seriesKey,
    );
    const anchor =
      members.find((item) => {
        const bookingId = bookingIdForQuotation(item, requestById);
        const booking = bookingId ? bookingById.get(bookingId) : null;
        return booking ? isRecurringJobAnchor(booking) : false;
      }) ?? members[0];
    if (anchor) result.push(anchor);
  }

  return result;
}

export function repeatingVisitCountForBookingId(
  bookingId: string | null | undefined,
  bookingById: ReadonlyMap<string, BookingDetail>,
): number {
  if (!bookingId) return 0;
  const booking = bookingById.get(bookingId);
  if (!booking) return 0;
  return recurringVisitCount(booking);
}
