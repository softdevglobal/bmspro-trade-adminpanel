"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useBookings } from "@/lib/bookings/use-bookings";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/types";
import type { BookingDetail } from "@/lib/bookings/types";
import {
  formatAddress,
  formatSlotDate,
  formatVisitWindow,
  TIME_RANGE_SHORT_LABELS,
} from "@/lib/inspection/types";
import { InspectionRequestCode } from "@/components/inspection-request-code";
import { displayBookingCode } from "@/lib/reference-codes";
import Link from "next/link";

function formatEstimatedMinutes(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} hr`;
  return `${hours} hr ${rem} min`;
}

function BookingCard({ booking }: { booking: BookingDetail }) {
  const title =
    booking.requestType === "existing_service"
      ? (booking.serviceName ?? "Existing service")
      : (booking.customRequest?.title ?? "Custom quotation request");

  const visitWindow = formatVisitWindow(
    booking.scheduledStartTime,
    booking.scheduledEndTime,
  );
  const estimate = formatEstimatedMinutes(booking.estimatedDurationMinutes);

  return (
    <article className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-primary/20 bg-surface-container-lowest p-4 shadow-sm sm:p-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-primary">
              {displayBookingCode(booking)}
            </span>
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              {BOOKING_STATUS_LABELS[booking.status]}
            </span>
          </div>
          <h4 className="mt-2 font-display text-[16px] font-semibold text-on-surface">
            {title}
          </h4>
          <p className="mt-1 font-body text-[11px] text-on-surface-variant">
            Visit{" "}
            <InspectionRequestCode
              request={{
                id: booking.inspectionRequestId,
                requestCode: booking.inspectionRequestCode,
              }}
              className="font-mono text-[11px] font-semibold text-on-surface-variant"
            />
          </p>
          <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
            {booking.customer.fullName} · {booking.customer.phone}
          </p>
          <p className="font-body text-[12px] text-on-surface-variant">
            {formatAddress(booking.address)}
          </p>
        </div>
      </div>

      {booking.scheduledSlot ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-outline-variant/40 pt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-body text-[11px] font-semibold text-primary ring-1 ring-primary/15">
            <span className="material-symbols-outlined text-[14px]">
              event
            </span>
            {formatSlotDate(booking.scheduledSlot.date)} ·{" "}
            {TIME_RANGE_SHORT_LABELS[booking.scheduledSlot.timeRange]}
            {visitWindow ? ` · ${visitWindow}` : null}
          </span>
          {estimate ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant/60 bg-surface-container-low px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">
                schedule
              </span>
              Est. {estimate} on site
            </span>
          ) : null}
          {booking.assignedTo ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-2.5 py-1 font-body text-[11px] font-semibold text-on-surface-variant sm:ml-auto">
              <span className="material-symbols-outlined text-[14px] text-primary">
                person
              </span>
              {booking.assignedTo.name}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function BookingsBoard() {
  const { status: authStatus } = useAuth();
  const { bookings, loading, error } = useBookings();

  if (authStatus === "loading" || loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((idx) => (
          <div
            key={idx}
            className="h-28 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
      >
        {error}
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
        <span className="material-symbols-outlined text-[40px] text-outline-variant">
          assignment
        </span>
        <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
          No job bookings yet
        </p>
        <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
          After an inspection visit is complete and you have sent a quotation,
          use Create booking on the completed visit to schedule the job here.
        </p>
        <Link
          href="/dashboard/inspection-visits"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
        >
          <span className="material-symbols-outlined text-[20px]">
            event_available
          </span>
          Inspection visits
        </Link>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {bookings.map((booking) => (
        <li key={booking.id}>
          <BookingCard booking={booking} />
        </li>
      ))}
    </ul>
  );
}
