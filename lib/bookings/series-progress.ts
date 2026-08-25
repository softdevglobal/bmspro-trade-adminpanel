import type { BookingDetail, BookingStatus } from "@/lib/bookings/types";
import { formatRecurrenceFrequencyLabel } from "@/lib/bookings/recurrence";
import { platformTodayIso } from "@/lib/platform/timezone";

/**
 * Progress through a repeating job, derived from the sibling visits that share
 * a `seriesId`.
 *
 * Every visit in a series is a real job document, so this counts the ones we
 * were given rather than re-expanding the recurrence rule — a visit skipped for
 * a business closure, or cancelled by hand, is reflected here where the rule
 * alone would still claim it exists.
 */
export type SeriesProgress = {
  seriesId: string;
  /** Visits actually found in the list we were handed. */
  loadedCount: number;
  /**
   * Visits the series is meant to have — `seriesCount` when the visits carry
   * it, otherwise the number found. May exceed `loadedCount` when the caller's
   * list is capped or filtered.
   */
  totalCount: number;
  completedCount: number;
  cancelledCount: number;
  /** Scheduled or ongoing visits still ahead of (or on) today. */
  remainingCount: number;
  /** Earliest still-open visit on or after today, if any. */
  nextVisitDate: string | null;
  /** Latest dated visit in the series, ignoring cancelled ones. */
  lastVisitDate: string | null;
  /** True when the caller's list may not hold the whole series. */
  partial: boolean;
};

const OPEN_STATUSES: ReadonlySet<BookingStatus> = new Set([
  "awaiting",
  "scheduled",
  "ongoing",
]);

function visitDate(booking: BookingDetail): string | null {
  const date = booking.scheduledSlot?.date?.trim();
  return date ? date : null;
}

/**
 * Groups `bookings` by series id. Visits without a `seriesId` are ignored, so
 * a list of one-off jobs yields an empty map.
 */
export function buildSeriesProgress(
  bookings: BookingDetail[],
  timeZone?: string | null,
): Map<string, SeriesProgress> {
  const today = platformTodayIso(new Date(), timeZone);
  const grouped = new Map<string, BookingDetail[]>();

  for (const booking of bookings) {
    const seriesId = booking.seriesId?.trim();
    if (!seriesId) continue;
    const existing = grouped.get(seriesId);
    if (existing) existing.push(booking);
    else grouped.set(seriesId, [booking]);
  }

  const result = new Map<string, SeriesProgress>();
  for (const [seriesId, visits] of grouped) {
    let completedCount = 0;
    let cancelledCount = 0;
    let remainingCount = 0;
    let nextVisitDate: string | null = null;
    let lastVisitDate: string | null = null;
    let declaredTotal = 0;

    for (const visit of visits) {
      if (visit.seriesCount && visit.seriesCount > declaredTotal) {
        declaredTotal = visit.seriesCount;
      }

      if (visit.status === "completed") completedCount += 1;
      if (visit.status === "cancelled") {
        cancelledCount += 1;
        continue; // cancelled visits never count as upcoming or as the end
      }

      const date = visitDate(visit);
      if (date && (!lastVisitDate || date > lastVisitDate)) {
        lastVisitDate = date;
      }

      if (!OPEN_STATUSES.has(visit.status)) continue;
      remainingCount += 1;
      if (date && date >= today && (!nextVisitDate || date < nextVisitDate)) {
        nextVisitDate = date;
      }
    }

    const loadedCount = visits.length;
    const totalCount = Math.max(declaredTotal, loadedCount);
    result.set(seriesId, {
      seriesId,
      loadedCount,
      totalCount,
      completedCount,
      cancelledCount,
      remainingCount,
      nextVisitDate,
      lastVisitDate,
      partial: totalCount > loadedCount,
    });
  }

  return result;
}

/**
 * The date this series stops. Prefers the rule's own end date (authoritative
 * even when the caller holds only part of the series) and falls back to the
 * latest visit actually seen. Null for an open-ended series.
 */
export function seriesEndDate(
  booking: BookingDetail,
  progress: SeriesProgress | null | undefined,
): string | null {
  const end = booking.recurrence?.end;
  if (end?.type === "on_date" && end.date) return end.date;
  // "never" runs until the server's horizon — no meaningful end to show.
  if (end?.type === "never") return null;
  return progress?.lastVisitDate ?? null;
}

/** "3 of 12 done" — the headline number for a series. */
export function formatSeriesProgressLabel(progress: SeriesProgress): string {
  return `${progress.completedCount} of ${progress.totalCount} done`;
}

/** Short repeat pattern for a card, e.g. "Every week on Monday". */
export function formatSeriesPatternLabel(
  booking: BookingDetail,
): string | null {
  if (!booking.recurrence) return null;
  return formatRecurrenceFrequencyLabel(booking.recurrence);
}
