"use client";

import { AdminDaySchedulePicker } from "@/components/admin-day-schedule-picker";
import {
  SlotDayPicker,
  todayIso,
} from "@/components/booking-slot-date-picker";
import {
  BookingStaffAssignSection,
  type BookingAssignChoice,
} from "@/components/booking-staff-assign-section";
import {
  JobInstructionsFields,
  normalizeInstructionTasksForSubmit,
} from "@/components/job-instructions-fields";
import { JobEstimateSelect } from "@/components/job-estimate-select";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import {
  estimateMinutesFromTimeRange,
  minutesBetweenClockTimes,
} from "@/lib/bookings/job-estimate";
import type { BookingStatus } from "@/lib/bookings/types";
import {
  timeRangeFromStartTime,
  type InspectionRequestDetail,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { useEffect, useState } from "react";

export function bookingMinDateFromInspection(
  request: Pick<
    InspectionRequestDetail,
    "scheduledSlot" | "preferredSlots"
  > | null,
  timeZone?: string | null,
): string {
  const scheduled = request?.scheduledSlot?.date?.trim();
  if (scheduled) return scheduled;
  const preferredDates = (request?.preferredSlots ?? [])
    .map((slot) => slot.date?.trim())
    .filter((date): date is string => Boolean(date))
    .sort();
  if (preferredDates.length > 0) return preferredDates[0];
  return todayIso(timeZone);
}

export function canConvertQuotationToBooking(quotation: {
  status: "draft" | "sent" | "cancelled";
  bookingId: string | null;
  bookingStatus?: BookingStatus | null;
  inspectionRequestStatus?: InspectionRequestDetail["status"] | null;
}): boolean {
  if (quotation.status !== "sent" || quotation.bookingId) return false;
  if (
    quotation.inspectionRequestStatus === "completed" ||
    quotation.inspectionRequestStatus === "awaiting_decision"
  ) {
    return true;
  }
  return quotation.bookingStatus === "awaiting";
}

export function ConvertToBookingPanel({
  inspectionRequestId,
  minBookingDate,
  initialStartTime = "10:00",
  initialEndTime = "11:00",
  onSuccess,
  onCancel,
}: {
  inspectionRequestId: string;
  minBookingDate: string;
  initialStartTime?: string;
  initialEndTime?: string;
  onSuccess: (request: InspectionRequestDetail) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const { staff } = useBusinessStaffSummary();
  const timeZone = profile?.timezone;
  const [assignChoice, setAssignChoice] = useState<BookingAssignChoice>("owner");
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<InspectionSlot>({
    date: minBookingDate,
    timeRange: "morning",
  });
  const [dayPage, setDayPage] = useState(0);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [estimatedMinutes, setEstimatedMinutes] = useState(() =>
    estimateMinutesFromTimeRange(initialStartTime, initialEndTime),
  );
  const [note, setNote] = useState("");
  const [instructionDescription, setInstructionDescription] = useState("");
  const [instructionTasks, setInstructionTasks] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlot({ date: minBookingDate, timeRange: "morning" });
    setDayPage(0);
    setStartTime(initialStartTime);
    setEndTime(initialEndTime);
    setEstimatedMinutes(
      estimateMinutesFromTimeRange(initialStartTime, initialEndTime),
    );
    setNote("");
    setInstructionDescription("");
    setInstructionTasks([]);
    setAssignChoice("owner");
    setStaffId("");
    setError(null);
  }, [
    inspectionRequestId,
    minBookingDate,
    initialStartTime,
    initialEndTime,
  ]);

  useEffect(() => {
    const minutes = minutesBetweenClockTimes(startTime, endTime);
    if (minutes != null) {
      setEstimatedMinutes(minutes);
    }
  }, [startTime, endTime]);

  async function handleSubmit() {
    if (!user) return;
    if (!slot.date) {
      setError("Choose a date for the job.");
      return;
    }
    if (!startTime || !endTime) {
      setError("Set a start and end time for the job.");
      return;
    }
    if (startTime >= endTime) {
      setError("The end time must be after the start time.");
      return;
    }
    if (assignChoice !== "owner" && assignChoice !== "staff") {
      setError("Choose who will run this job.");
      return;
    }
    if (assignChoice === "staff" && !staffId) {
      setError("Choose a team member to assign.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/requests/${inspectionRequestId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "convert_to_booking",
            slot: {
              date: slot.date,
              timeRange: timeRangeFromStartTime(startTime),
            },
            startTime,
            endTime,
            estimatedDurationMinutes: estimatedMinutes,
            note: note.trim() || undefined,
            instructionDescription: instructionDescription.trim() || undefined,
            instructionTasks: normalizeInstructionTasksForSubmit(instructionTasks),
            assignTo: assignChoice,
            ...(assignChoice === "staff" ? { staffId } : {}),
          }),
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        request?: InspectionRequestDetail;
      };
      if (!response.ok || !data.ok || !data.request) {
        throw new Error(data.error ?? "Could not create job.");
      }
      onSuccess(data.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create job.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <h4 className="font-display text-[15px] font-semibold text-on-surface">
        Create job
      </h4>
      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
        Schedule the job after the customer accepted your quotation (or when they
        confirmed by phone).
      </p>

      <div className="mt-4">
        <SlotDayPicker
          selectedIso={slot.date}
          minDate={minBookingDate}
          dayPage={dayPage}
          onDayPageChange={setDayPage}
          onSelect={(iso) => setSlot({ ...slot, date: iso })}
          disabled={submitting}
          dayStripLayout="fit"
          timeZone={timeZone}
        />
      </div>

      {slot.date ? (
        <div className="mt-4">
          <AdminDaySchedulePicker
            date={slot.date}
            kind="job"
            startTime={startTime}
            endTime={endTime}
            disabled={submitting}
            onStartTimeChange={setStartTime}
            onEndTimeChange={setEndTime}
          />
        </div>
      ) : null}

      <label className="mt-4 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Estimated time on site
        </span>
        <JobEstimateSelect
          value={estimatedMinutes}
          disabled={submitting}
          onChange={setEstimatedMinutes}
        />
      </label>

      <div className="mt-4">
        <BookingStaffAssignSection
          staff={staff}
          choice={assignChoice}
          staffId={staffId}
          disabled={submitting}
          assignmentDate={slot.date}
          startTime={startTime}
          endTime={endTime}
          onChoiceChange={(next) => {
            setAssignChoice(next);
            if (next !== "staff") setStaffId("");
          }}
          onStaffIdChange={setStaffId}
        />
      </div>

      <div className="mt-4">
        <JobInstructionsFields
          description={instructionDescription}
          tasks={instructionTasks}
          disabled={submitting}
          onDescriptionChange={setInstructionDescription}
          onTasksChange={setInstructionTasks}
        />
      </div>

      <label className="mt-4 block">
        <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
          Note for customer (optional)
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. Please ensure access to the meter box."
          disabled={submitting}
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
        />
      </label>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            className={`material-symbols-outlined text-[18px] ${
              submitting ? "animate-spin" : ""
            }`}
          >
            {submitting ? "progress_activity" : "assignment"}
          </span>
          {submitting ? "Creating…" : "Create job"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
