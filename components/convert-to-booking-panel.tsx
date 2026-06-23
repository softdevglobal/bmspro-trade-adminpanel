"use client";

import { AdminDaySchedulePicker } from "@/components/admin-day-schedule-picker";
import {
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
  TIME_RANGE_LABELS,
  formatSlotDate,
  sortInspectionSlots,
  timeRangeFromStartTime,
  type InspectionRequestDetail,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { useEffect, useMemo, useState } from "react";

type JobDateSource = "customer" | "admin" | "accepted";

type JobDayGroup = {
  id: JobDateSource;
  label: string;
  hint: string;
  slots: InspectionSlot[];
};

function slotKey(slot: InspectionSlot): string {
  return `${slot.date}-${slot.timeRange}`;
}

function buildJobDayGroups({
  customerJobPreferredSlots,
  adminJobPreferredSlots,
  jobProposedSlots,
  customerAcceptedJobSlot,
}: {
  customerJobPreferredSlots: InspectionSlot[];
  adminJobPreferredSlots: InspectionSlot[];
  jobProposedSlots: InspectionSlot[];
  customerAcceptedJobSlot: InspectionSlot | null;
}): JobDayGroup[] {
  const groups: JobDayGroup[] = [];

  if (customerAcceptedJobSlot) {
    groups.push({
      id: "accepted",
      label: "Customer accepted day",
      hint: "They picked this from your proposed dates. This is the default for the job.",
      slots: [customerAcceptedJobSlot],
    });
  }

  if (customerJobPreferredSlots.length > 0) {
    groups.push({
      id: "customer",
      label: "Customer's original job days",
      hint: "Chosen when they accepted your quotation. You can still schedule on one of these instead.",
      slots: customerJobPreferredSlots,
    });
  }

  const adminSlots =
    jobProposedSlots.length > 0 ? jobProposedSlots : adminJobPreferredSlots;
  if (adminSlots.length > 0) {
    groups.push({
      id: "admin",
      label: "Your proposed job days",
      hint: "Alternatives you sent when their original dates did not work.",
      slots: adminSlots,
    });
  }

  return groups;
}

function defaultJobSlot(
  groups: JobDayGroup[],
  minBookingDate: string,
): InspectionSlot {
  const accepted = groups.find((group) => group.id === "accepted")?.slots[0];
  if (accepted) return accepted;
  const customer = groups.find((group) => group.id === "customer")?.slots;
  const [firstCustomer] = sortInspectionSlots(customer ?? []);
  if (firstCustomer) return firstCustomer;
  const admin = groups.find((group) => group.id === "admin")?.slots;
  const [firstAdmin] = sortInspectionSlots(admin ?? []);
  if (firstAdmin) return firstAdmin;
  return { date: minBookingDate, timeRange: "morning" };
}

export function bookingMinDateFromInspection(
  request: Pick<
    InspectionRequestDetail,
    | "scheduledSlot"
    | "preferredSlots"
    | "jobPreferredSlots"
    | "adminJobPreferredSlots"
  > | null,
  timeZone?: string | null,
): string {
  const scheduled = request?.scheduledSlot?.date?.trim();
  if (scheduled) return scheduled;
  const preferredDates = [
    ...(request?.jobPreferredSlots ?? []),
    ...(request?.adminJobPreferredSlots ?? []),
    ...(request?.preferredSlots ?? []),
  ]
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
  customerJobPreferredSlots = [],
  adminJobPreferredSlots = [],
  jobProposedSlots = [],
  customerAcceptedJobSlot = null,
  initialStartTime = "10:00",
  initialEndTime = "11:00",
  onSuccess,
  onCancel,
}: {
  inspectionRequestId: string;
  minBookingDate: string;
  customerJobPreferredSlots?: InspectionSlot[];
  adminJobPreferredSlots?: InspectionSlot[];
  jobProposedSlots?: InspectionSlot[];
  customerAcceptedJobSlot?: InspectionSlot | null;
  initialStartTime?: string;
  initialEndTime?: string;
  onSuccess: (request: InspectionRequestDetail) => void;
  onCancel: () => void;
}) {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const { staff } = useBusinessStaffSummary();
  const timeZone = profile?.timezone;
  const dayGroups = useMemo(
    () =>
      buildJobDayGroups({
        customerJobPreferredSlots,
        adminJobPreferredSlots,
        jobProposedSlots,
        customerAcceptedJobSlot,
      }),
    [
      customerJobPreferredSlots,
      adminJobPreferredSlots,
      jobProposedSlots,
      customerAcceptedJobSlot,
    ],
  );
  const selectableSlots = useMemo(
    () => dayGroups.flatMap((group) => group.slots),
    [dayGroups],
  );
  const initialSlot = useMemo(
    () => defaultJobSlot(dayGroups, minBookingDate),
    [dayGroups, minBookingDate],
  );
  const [assignChoice, setAssignChoice] = useState<BookingAssignChoice>("owner");
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<InspectionSlot>(initialSlot);
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
    setSlot(initialSlot);
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
    initialSlot,
  ]);

  useEffect(() => {
    if (
      selectableSlots.some(
        (option) =>
          option.date === slot.date && option.timeRange === slot.timeRange,
      )
    ) {
      return;
    }
    setSlot(initialSlot);
  }, [selectableSlots, initialSlot, slot.date, slot.timeRange]);

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
        Schedule the job after the customer accepted your quotation. If they
        accepted a proposed day, that is selected by default — you can still
        pick one of their original job days instead.
      </p>

      {dayGroups.length > 0 ? (
        <div className="mt-4 space-y-4">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Choose a day
          </p>
          {dayGroups.map((group) => (
            <div key={group.id} className="space-y-2">
              <div>
                <p className="font-body text-[12px] font-bold text-on-surface">
                  {group.label}
                </p>
                <p className="mt-0.5 font-body text-[11px] text-on-surface-variant">
                  {group.hint}
                </p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {sortInspectionSlots(group.slots).map((preferred) => {
                  const active = slotKey(slot) === slotKey(preferred);
                  return (
                    <li key={slotKey(preferred)}>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => setSlot(preferred)}
                        className={`rounded-lg border px-3 py-2 font-body text-[12px] font-semibold transition-colors disabled:opacity-60 ${
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-outline-variant/60 bg-white text-on-surface hover:bg-surface-container"
                        }`}
                      >
                        {formatSlotDate(preferred.date, timeZone)} ·{" "}
                        {TIME_RANGE_LABELS[preferred.timeRange]}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed border-amber-200 bg-amber-50/80 px-3 py-2.5 font-body text-[12px] text-amber-900">
          No job days to schedule yet. Use the customer&apos;s preferred dates,
          propose alternative days, or wait for the customer to accept a proposed
          day.
        </p>
      )}

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
          disabled={submitting || selectableSlots.length === 0 || !slot.date}
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
