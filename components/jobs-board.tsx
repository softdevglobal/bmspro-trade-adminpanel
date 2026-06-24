"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useBookings } from "@/lib/bookings/use-bookings";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONE,
} from "@/lib/bookings/types";
import type { BookingDetail, BookingStatus } from "@/lib/bookings/types";
import {
  bookingScheduleDays,
  sortBookingsBySchedule,
} from "@/lib/bookings/map-booking-doc";
import { estimateMinutesFromTimeRange } from "@/lib/bookings/job-estimate";
import { bookingForCalendar } from "@/lib/calendar/events";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  formatAddress,
  formatSlotDate,
  formatVisitWindow,
  isClockTime,
  TIME_RANGE_LABELS,
  TIME_RANGE_SHORT_LABELS,
  type InspectionRequestDetail,
} from "@/lib/inspection/types";
import { formatInPlatformTimeZone } from "@/lib/platform/timezone";
import { InspectionRequestCode } from "@/components/inspection-request-code";
import { AddInspectionModal } from "@/components/add-inspection-modal";
import { JobInstructionsDisplay, JobInstructionsGlance } from "@/components/job-instructions-display";
import { StaffMemberPicker } from "@/components/staff-member-picker";
import { displayBookingCode, displayQuotationCode } from "@/lib/reference-codes";
import { buildStaffAssignmentBlockMap } from "@/lib/team/staff-assign-blocks";
import { useLeaveRequests } from "@/lib/leave/leave-requests-context";
import {
  formatAuPhoneDisplay,
  formatAuPhoneTelHref,
} from "@/lib/phone/au-phone";
import {
  useBusinessStaffSummary,
} from "@/lib/team/use-business-staff-summary";
import type { StaffSummary } from "@/lib/team/staff-summary-cache";
import { staffAvatarUrl } from "@/lib/team/staff-avatar";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PreviewMode = "review" | "assign";
type JobsFilter = "active" | "completed";

const JOB_TABS: { id: JobsFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
];

function formatEstimatedMinutes(minutes: number | null): string | null {
  if (minutes == null || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return `${hours} hr`;
  return `${hours} hr ${rem} min`;
}

function formatWhen(timestamp: number | null, timeZone?: string | null): string {
  if (!timestamp) return "—";
  return formatInPlatformTimeZone(timestamp, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }, timeZone);
}

function formatAud(value: number | null): string {
  if (value == null) return "—";
  return `Aus $${value.toFixed(2)}`;
}

function bookingTitle(booking: BookingDetail): string {
  if (booking.requestType === "existing_service") {
    return booking.serviceName ?? "Existing service";
  }
  return booking.customRequest?.title ?? "Custom quotation request";
}

function BookingStatusPill({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider ${BOOKING_STATUS_TONE[status]}`}
    >
      {BOOKING_STATUS_LABELS[status]}
    </span>
  );
}

function BookingCard({
  booking,
  isPreviewOpen,
  onOpen,
  timeZone,
}: {
  booking: BookingDetail;
  isPreviewOpen: boolean;
  onOpen: () => void;
  timeZone?: string | null;
}) {
  const title = bookingTitle(booking);
  const visitWindow = formatVisitWindow(
    booking.scheduledStartTime,
    booking.scheduledEndTime,
  );
  const estimate = formatEstimatedMinutes(booking.estimatedDurationMinutes);
  const displayPhone = formatAuPhoneDisplay(booking.customer.phone);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-surface-container-lowest p-4 text-left shadow-sm transition-all sm:p-5 ${
        isPreviewOpen
          ? "border-primary/40 ring-2 ring-primary/15"
          : "border-primary/20 hover:border-primary/30 hover:shadow-md"
      }`}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-primary">
              {displayBookingCode(booking)}
            </span>
            <BookingStatusPill status={booking.status} />
            {booking.status === "scheduled" && !booking.assignedTo ? (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-body text-[11px] font-bold uppercase tracking-wider text-amber-800">
                Unassigned
              </span>
            ) : null}
          </div>
          <h4 className="mt-2 font-display text-[16px] font-semibold text-on-surface">
            {booking.customer.fullName || "Customer"}
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
            Service: {title}
          </p>
          <p className="font-body text-[13px] text-on-surface-variant">
            {displayPhone}
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
            {formatSlotDate(booking.scheduledSlot.date, timeZone)} ·{" "}
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
          <JobInstructionsGlance booking={booking} />
        </div>
      ) : null}
    </button>
  );
}

function BookingPreviewDrawer({
  booking,
  staff,
  onClose,
  onUpdated,
  timeZone,
  requestsById,
}: {
  booking: BookingDetail | null;
  staff: StaffSummary[];
  onClose: () => void;
  onUpdated: (next: BookingDetail) => void;
  timeZone?: string | null;
  requestsById: ReadonlyMap<string, InspectionRequestDetail>;
}) {
  const open = booking !== null;
  useRegisterRightDrawer(open, "lg");

  return (
    <AnimatePresence>
      {open && booking ? (
        <motion.div
          key="booking-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 overflow-hidden bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.aside
            key="booking-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Job preview: ${displayBookingCode(booking)}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-full flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-surface-container-lowest shadow-2xl will-change-transform sm:w-full sm:max-w-[720px] sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <BookingPreviewContent
              key={booking.id}
              booking={booking}
              staff={staff}
              onClose={onClose}
              onUpdated={onUpdated}
              timeZone={timeZone}
              requestsById={requestsById}
            />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function BookingAssignForm({
  staff,
  assignTo,
  staffId,
  disabled,
  assignmentDate,
  startTime,
  endTime,
  timeZone,
  onAssignToChange,
  onStaffIdChange,
  onCancel,
  onSubmit,
}: {
  staff: StaffSummary[];
  assignTo: "owner" | "staff" | null;
  staffId: string;
  disabled: boolean;
  assignmentDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone?: string | null;
  onAssignToChange: (value: "owner" | "staff") => void;
  onStaffIdChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { user } = useAuth();
  const { leaveRequests } = useLeaveRequests();
  const ownerAvatar = staffAvatarUrl({
    id: user?.uid ?? "owner",
    fullName: user?.displayName ?? "Business owner",
    email: user?.email ?? "",
  });

  const blockedLabels = useMemo(() => {
    return buildStaffAssignmentBlockMap(
      staff,
      leaveRequests,
      assignmentDate,
      startTime,
      endTime,
      timeZone,
    );
  }, [leaveRequests, staff, assignmentDate, startTime, endTime, timeZone]);

  useEffect(() => {
    if (staffId && blockedLabels[staffId]) onStaffIdChange("");
  }, [staffId, blockedLabels, onStaffIdChange]);

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <p className="font-display text-[14px] font-semibold text-on-surface">
        Assign this job
      </p>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Choose who will run the booked work. This is separate from the
        inspection and quotation.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onAssignToChange("owner")}
          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
            assignTo === "owner"
              ? "border-primary bg-white ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ownerAvatar}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full border-2 border-white bg-surface-container-low object-cover shadow-sm ring-1 ring-outline-variant/30"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign to me
            </span>
            <span className="block truncate font-body text-[11px] text-on-surface-variant">
              {user?.displayName ?? user?.email ?? "Business owner"}
            </span>
          </span>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
              assignTo === "owner"
                ? "border-primary bg-primary text-on-primary"
                : "border-stone-300 bg-transparent"
            }`}
            aria-hidden
          >
            {assignTo === "owner" ? (
              <span className="material-symbols-outlined text-[14px]">check</span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onAssignToChange("staff")}
          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
            assignTo === "staff"
              ? "border-primary bg-white ring-1 ring-primary/30"
              : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <span className="material-symbols-outlined text-[20px]">
              groups
            </span>
          </span>
          <span>
            <span className="block font-body text-[13px] font-semibold text-on-surface">
              Assign a team member
            </span>
            <span className="block font-body text-[11px] text-on-surface-variant">
              Pick from your active team.
            </span>
          </span>
        </button>
      </div>

      {assignTo === "staff" ? (
        <div className="mt-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Choose a team member
          </p>
          {staff.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface-variant">
              No active staff members yet. Add team members from the Team
              page.
            </p>
          ) : (
            <div className="mt-2">
              <StaffMemberPicker
                staff={staff}
                value={staffId}
                disabled={disabled}
                blockedLabels={blockedLabels}
                onChange={onStaffIdChange}
              />
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-lg border border-outline-variant px-4 py-2 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          Assign member
        </button>
      </div>
    </section>
  );
}

function BookingPreviewContent({
  booking,
  staff,
  onClose,
  onUpdated,
  timeZone,
  requestsById,
}: {
  booking: BookingDetail;
  staff: StaffSummary[];
  onClose: () => void;
  onUpdated: (next: BookingDetail) => void;
  timeZone?: string | null;
  requestsById: ReadonlyMap<string, InspectionRequestDetail>;
}) {
  const displayBooking = useMemo(
    () => bookingForCalendar(booking, requestsById),
    [booking, requestsById],
  );
  const scheduleDays = useMemo(
    () => bookingScheduleDays(displayBooking),
    [displayBooking],
  );
  const { user } = useAuth();
  const [mode, setMode] = useState<PreviewMode>("review");
  const [assignTo, setAssignTo] = useState<"owner" | "staff" | null>(null);
  const [staffId, setStaffId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const title = bookingTitle(booking);
  const displayPhone = formatAuPhoneDisplay(booking.customer.phone);
  const phoneHref = formatAuPhoneTelHref(booking.customer.phone);
  const emailHref = booking.customer.email
    ? `mailto:${booking.customer.email}`
    : null;
  const canAssign = booking.status === "scheduled";
  const invoiceHref = booking.quotation?.id
    ? `/dashboard/invoices?quotation=${encodeURIComponent(booking.quotation.id)}`
    : null;
  const canCreateInvoice =
    booking.status === "scheduled" &&
    Boolean(invoiceHref) &&
    booking.quotation?.status === "sent" &&
    booking.quotation.customerDecision !== "rejected";

  async function submitAssign() {
    if (!user) return;
    if (!assignTo) {
      setActionError("Pick who should run this job.");
      return;
    }
    if (assignTo === "staff" && !staffId) {
      setActionError("Choose a team member to assign.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/jobs/${booking.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "assign",
          assignTo,
          staffId: assignTo === "staff" ? staffId : undefined,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        booking?: BookingDetail;
      };
      if (!response.ok || !data.ok || !data.booking) {
        throw new Error(data.error ?? "Could not assign this booking.");
      }
      onUpdated(data.booking);
      setMode("review");
      setAssignTo(null);
      setStaffId("");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not assign this booking.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
            Job preview
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary">
              {displayBookingCode(booking)}
            </span>
            <BookingStatusPill status={booking.status} />
          </div>
          <h3 className="mt-2 font-display text-[20px] font-semibold text-on-surface">
            {title}
          </h3>
          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
            Created {formatWhen(booking.createdAt, timeZone)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3 sm:space-y-3 sm:px-5">
        {mode === "assign" ? (
          <BookingAssignForm
            staff={staff}
            assignTo={assignTo}
            staffId={staffId}
            disabled={submitting}
            assignmentDate={booking.scheduledSlot?.date ?? null}
            startTime={booking.scheduledStartTime}
            endTime={booking.scheduledEndTime}
            timeZone={timeZone}
            onAssignToChange={setAssignTo}
            onStaffIdChange={setStaffId}
            onCancel={() => {
              setMode("review");
              setActionError(null);
            }}
            onSubmit={() => void submitAssign()}
          />
        ) : (
          <>
        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Customer
          </p>
          <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
            {booking.customer.fullName}
          </p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            <a
              href={phoneHref ?? "#"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-low px-2.5 py-1.5 font-body text-[13px] text-on-surface transition-colors hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                call
              </span>
              {displayPhone || "—"}
            </a>
            <a
              href={emailHref ?? "#"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-low px-2.5 py-1.5 font-body text-[13px] text-on-surface transition-colors hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[16px] text-primary">
                mail
              </span>
              <span className="truncate">{booking.customer.email || "—"}</span>
            </a>
          </div>
          <p className="mt-2 inline-flex items-start gap-1.5 font-body text-[13px] leading-snug text-on-surface">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[16px] text-primary">
              location_on
            </span>
            {formatAddress(booking.address)}
          </p>
        </section>

        {booking.requestType === "existing_service" ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Service
            </p>
            <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
              {booking.serviceName ?? "—"}
            </p>
            {booking.serviceBusinessType ? (
              <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                {booking.serviceBusinessType}
              </p>
            ) : null}
          </section>
        ) : (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Custom quote request
            </p>
            <p className="mt-0.5 font-display text-[15px] font-semibold text-on-surface">
              {booking.customRequest?.title ?? "—"}
            </p>
            {booking.customRequest?.description ? (
              <p className="mt-1.5 whitespace-pre-line font-body text-[13px] leading-relaxed text-on-surface-variant">
                {booking.customRequest.description}
              </p>
            ) : null}
          </section>
        )}

        {scheduleDays.length > 0 ? (
          <section className="rounded-xl border border-primary/25 bg-primary/5 p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
              Schedule
              {scheduleDays.length > 1
                ? ` · ${scheduleDays.length} days`
                : null}
            </p>
            <div className="mt-2 space-y-2">
              {scheduleDays.map((day, index) => {
                const dayWindow = formatVisitWindow(day.startTime, day.endTime);
                const dayEstimate =
                  isClockTime(day.startTime) && isClockTime(day.endTime)
                    ? formatEstimatedMinutes(
                        estimateMinutesFromTimeRange(
                          day.startTime,
                          day.endTime,
                        ),
                      )
                    : index === 0
                      ? formatEstimatedMinutes(
                          booking.estimatedDurationMinutes,
                        )
                      : null;

                return (
                  <div
                    key={day.date}
                    className="rounded-xl border border-primary/20 bg-surface-container-lowest p-3"
                  >
                    {scheduleDays.length > 1 ? (
                      <p className="font-body text-[10px] font-bold uppercase tracking-wider text-primary">
                        Day {index + 1}
                      </p>
                    ) : null}
                    <p
                      className={`flex items-center gap-1.5 font-body text-[13px] font-semibold text-on-surface ${
                        scheduleDays.length > 1 ? "mt-1" : ""
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px] text-primary">
                        event
                      </span>
                      {formatSlotDate(day.date, timeZone)}
                      {dayWindow ? null : (
                        <>
                          {" · "}
                          {TIME_RANGE_LABELS[day.slot.timeRange]}
                        </>
                      )}
                    </p>
                    {dayWindow ? (
                      <p className="mt-2 flex items-center gap-1.5 font-body text-[12px] font-semibold text-emerald-800">
                        <span className="material-symbols-outlined text-[14px] text-emerald-700">
                          schedule
                        </span>
                        {dayWindow}
                      </p>
                    ) : null}
                    {dayEstimate ? (
                      <p className="mt-2 flex items-center gap-1.5 font-body text-[12px] text-on-surface-variant">
                        <span className="material-symbols-outlined text-[14px] text-primary">
                          timelapse
                        </span>
                        Estimated {dayEstimate} on site
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <JobInstructionsDisplay
          description={booking.jobInstructionsDescription}
          tasks={booking.jobInstructionsTasks}
        />

        {canAssign ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                  Assigned member
                </p>
                {booking.assignedTo ? (
                  <>
                    <p className="mt-1 flex items-center gap-2 font-body text-[14px] font-semibold text-on-surface">
                      <span className="material-symbols-outlined text-[18px] text-primary">
                        person
                      </span>
                      {booking.assignedTo.name}
                    </p>
                    {booking.assignedTo.email ? (
                      <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                        {booking.assignedTo.email}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1 flex items-center gap-2 font-body text-[13px] font-semibold text-amber-800">
                    <span className="material-symbols-outlined text-[18px]">
                      person_off
                    </span>
                    No one assigned yet
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setMode("assign");
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 font-body text-[12px] font-semibold text-primary transition-colors hover:bg-primary/15"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {booking.assignedTo ? "swap_horiz" : "person_add"}
                </span>
                {booking.assignedTo ? "Change" : "Assign"}
              </button>
            </div>
          </section>
        ) : booking.assignedTo ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Assigned to
            </p>
            <p className="mt-1 flex items-center gap-2 font-body text-[14px] font-semibold text-on-surface">
              <span className="material-symbols-outlined text-[18px] text-primary">
                person
              </span>
              {booking.assignedTo.name}
            </p>
            {booking.assignedTo.email ? (
              <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                {booking.assignedTo.email}
              </p>
            ) : null}
          </section>
        ) : null}

        {booking.quotation ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Quotation
            </p>
            <div className="mt-2 rounded-xl border border-outline-variant/60 bg-surface-container-low p-3">
              <p className="font-mono text-[11px] font-semibold tracking-wide text-primary">
                {displayQuotationCode(booking.quotation)}
              </p>
              <p className="mt-1 font-numeric text-[15px] font-semibold text-on-surface">
                {formatAud(booking.quotation.finalPriceAud)}
              </p>
              {booking.quotation.pdfUrl ? (
                <a
                  href={booking.quotation.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-body text-[12px] font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    picture_as_pdf
                  </span>
                  View PDF
                </a>
              ) : null}
              {canCreateInvoice && invoiceHref ? (
                <Link
                  href={invoiceHref}
                  onClick={onClose}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    receipt_long
                  </span>
                  Create invoice
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {booking.beforeImageUrls.length > 0 ||
        booking.afterImageUrls.length > 0 ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Completion photos
            </p>
            {booking.beforeImageUrls.length > 0 ? (
              <div className="mt-3">
                <p className="font-body text-[12px] font-semibold text-on-surface">
                  Before
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {booking.beforeImageUrls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-lg border border-outline-variant/60"
                      >
                        <img
                          src={url}
                          alt="Before work"
                          className="h-20 w-20 object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {booking.afterImageUrls.length > 0 ? (
              <div className="mt-3">
                <p className="font-body text-[12px] font-semibold text-on-surface">
                  After
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {booking.afterImageUrls.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-lg border border-outline-variant/60"
                      >
                        <img
                          src={url}
                          alt="After work"
                          className="h-20 w-20 object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {booking.ownerNote ? (
          <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 py-2.5">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Note for customer
            </p>
            <p className="mt-1 font-body text-body-md text-on-surface">
              {booking.ownerNote}
            </p>
          </section>
        ) : null}

        <section className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Linked visit
          </p>
          <Link
            href={`/dashboard/requests?request=${booking.inspectionRequestId}`}
            onClick={onClose}
            className="mt-2 flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-low px-3 py-2.5 font-body text-[13px] font-semibold text-primary transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[18px]">
              event_available
            </span>
            <InspectionRequestCode
              request={{
                id: booking.inspectionRequestId,
                requestCode: booking.inspectionRequestCode,
              }}
              className="font-mono text-[13px] font-semibold text-primary"
            />
          </Link>
        </section>
          </>
        )}

        {actionError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
          >
            {actionError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function JobsBoard({
  initialJobId = null,
}: {
  initialJobId?: string | null;
}) {
  const { status: authStatus } = useAuth();
  const profile = useBusinessProfile();
  const { bookings, loading, error } = useBookings();
  const { requests } = useInspectionRequests();
  const { staff } = useBusinessStaffSummary();
  const requestsById = useMemo(
    () => new Map(requests.map((request) => [request.id, request])),
    [requests],
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialJobId);
  const [filter, setFilter] = useState<JobsFilter>("active");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [localBookingState, setLocalBookingState] = useState<{
    source: BookingDetail[];
    bookings: BookingDetail[];
  } | null>(
    null,
  );

  const displayBookings =
    localBookingState?.source === bookings
      ? localBookingState.bookings
      : bookings;
  const groupedBookings = useMemo(() => {
    const groups = displayBookings.reduce(
      (groups, booking) => {
        if (booking.status === "completed") {
          groups.completed.push(booking);
        } else {
          groups.active.push(booking);
        }
        return groups;
      },
      {
        active: [] as BookingDetail[],
        completed: [] as BookingDetail[],
      },
    );
    return {
      active: sortBookingsBySchedule(groups.active),
      completed: sortBookingsBySchedule(groups.completed),
    };
  }, [displayBookings]);
  const timeZone = profile?.timezone;

  const selected = useMemo(
    () => displayBookings.find((booking) => booking.id === selectedId) ?? null,
    [displayBookings, selectedId],
  );
  const activeFilter =
    selectedId === initialJobId && selected?.status === "completed"
      ? "completed"
      : filter;
  const visibleBookings = groupedBookings[activeFilter];

  function handleBookingUpdated(next: BookingDetail) {
    setLocalBookingState((current) => {
      const base =
        current?.source === bookings ? current.bookings : bookings;
      return {
        source: bookings,
        bookings: base.map((booking) =>
          booking.id === next.id ? next : booking,
        ),
      };
    });
  }

  function handleFilterChange(nextFilter: JobsFilter) {
    setFilter(nextFilter);
    setSelectedId(null);
  }

  const addJobModal = (
    <AddInspectionModal
      open={addModalOpen}
      variant="job"
      onClose={() => setAddModalOpen(false)}
      onCreated={(jobId) => {
        setAddModalOpen(false);
        if (jobId) setSelectedId(jobId);
      }}
    />
  );

  if (authStatus === "loading" || loading) {
    return (
      <>
        <div className="space-y-3">
          {[0, 1].map((idx) => (
            <div
              key={idx}
              className="h-28 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
            />
          ))}
        </div>
        {addJobModal}
      </>
    );
  }

  if (error) {
    return (
      <>
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700"
        >
          {error}
        </div>
        {addJobModal}
      </>
    );
  }

  if (displayBookings.length === 0) {
    return (
      <>
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">
              add
            </span>
            Add job
          </button>
        </div>
        <div className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-6 py-14 text-center sm:rounded-2xl sm:py-16">
          <span className="material-symbols-outlined text-[40px] text-outline-variant">
            assignment
          </span>
          <p className="mt-4 font-display text-[20px] font-semibold text-on-surface">
            No jobs yet
          </p>
          <p className="mx-auto mt-2 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
            Add a job directly when work is already agreed, or create one from a
            completed request and quotation.
          </p>
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[20px]">
              handyman
            </span>
            Add job
          </button>
        </div>
        {addJobModal}
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-body text-[12px] text-on-surface-variant">
          {groupedBookings.active.length} active ·{" "}
          {groupedBookings.completed.length} completed · tap a card to open the
          side preview
        </p>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary/90 sm:w-auto"
        >
          <span className="material-symbols-outlined text-[14px] leading-none">
            add
          </span>
          Add job
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Filter jobs"
        className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-outline-variant/60 bg-surface-container-low p-1"
      >
        {JOB_TABS.map((tab) => {
          const selectedTab = activeFilter === tab.id;
          const count = groupedBookings[tab.id].length;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selectedTab}
              onClick={() => handleFilterChange(tab.id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 font-body text-[12px] font-bold transition-colors ${
                selectedTab
                  ? "bg-primary text-on-primary shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  selectedTab
                    ? "bg-on-primary/15 text-on-primary"
                    : "bg-surface-container-lowest text-on-surface-variant"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {visibleBookings.length > 0 ? (
        <ul className="space-y-3">
          {visibleBookings.map((booking) => (
            <li key={booking.id}>
              <BookingCard
                booking={booking}
                isPreviewOpen={selectedId === booking.id}
                onOpen={() => setSelectedId(booking.id)}
                timeZone={timeZone}
              />
            </li>
          ))}
        </ul>
      ) : (
        <section className="rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-lowest px-5 py-8 text-center">
          <p className="font-display text-[17px] font-semibold text-on-surface">
            No {activeFilter} jobs
          </p>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            Jobs for this tab will appear here.
          </p>
        </section>
      )}

      <BookingPreviewDrawer
        booking={selected}
        staff={staff}
        onClose={() => setSelectedId(null)}
        onUpdated={handleBookingUpdated}
        timeZone={timeZone}
        requestsById={requestsById}
      />

      {addJobModal}
    </>
  );
}
