"use client";

import { AdminDaySchedulePicker } from "@/components/admin-day-schedule-picker";
import { AuPhoneInput } from "@/components/au-phone-input";
import {
  calendarVisitTimeRange,
  defaultCalendarVisitEnd,
  validateCalendarVisitWindow,
} from "@/components/calendar-visit-time-range";
import type { CalendarSlotSelection } from "@/lib/calendar/time-slots";
import { JobAssignPicker } from "@/components/job-assign-picker";
import { SlotDayPicker, todayIso } from "@/components/booking-slot-date-picker";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useBusinessWorkingHours } from "@/lib/calendar/use-business-working-hours";
import type { BusinessWorkingHours } from "@/lib/calendar/working-hours";
import { useBusinessStaffSummary } from "@/lib/team/use-business-staff-summary";
import { useBookings } from "@/lib/bookings/use-bookings";
import {
  buildCustomerOptions,
  filterCustomerOptions,
  formatCustomerAddressLine,
  hasUsableCustomerAddress,
  type CustomerOption,
} from "@/lib/inspection/customer-options";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  TIME_RANGE_LABELS,
  formatAddress,
  formatSlotDate,
  formatVisitWindow,
  isClockTime,
  sortInspectionSlots,
} from "@/lib/inspection/types";
import type {
  InspectionRequestType,
  InspectionSlot,
  InspectionTimeRange,
} from "@/lib/inspection/types";
import type { BusinessServiceDetail } from "@/lib/onboarding/services/display";
import { iconForBusinessType } from "@/lib/onboarding/types";
import {
  formatAuPhoneDisplay,
  toAuLocalPhoneDigits,
} from "@/lib/phone/au-phone";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called with the new request id (inspection) or job id (direct job). */
  onCreated?: (id: string) => void;
  /** Pre-select date and time range when opening from the calendar. */
  initialCalendarWindow?: CalendarSlotSelection | null;
  /** @deprecated Use initialCalendarWindow */
  initialPreferredSlot?: InspectionSlot | null;
  /** Calendar add menu: inspection request vs direct job intake. */
  variant?: "inspection" | "job";
};

type ServiceAddress = {
  street: string;
  suburb: string;
  state: string;
  postcode: string;
};

const STEPS = [
  {
    title: "What do you need?",
    subtitle:
      "Choose an existing service or describe a custom job for a quote.",
  },
  {
    title: "Service address",
    subtitle: "Where should the inspector visit?",
  },
  {
    title: "Preferred dates & times",
    subtitle: "Pick up to 3 days, then choose hourly time slots for each.",
  },
  {
    title: "Contact details",
    subtitle:
      "Customer contact info for confirming the visit and day-of communication.",
  },
  {
    title: "Review & create",
    subtitle:
      "Check everything below, then create the request.",
  },
] as const;

const JOB_STEPS = [
  {
    title: "What is the job?",
    subtitle: "Choose an existing service or describe custom work.",
  },
  {
    title: "Service address",
    subtitle: "Where should the team visit?",
  },
  {
    title: "Schedule the job",
    subtitle: "Pick day(s) and hourly slots — one slot equals one hour on site.",
  },
  {
    title: "Contact details",
    subtitle: "Customer contact info for the visit and follow-up.",
  },
  {
    title: "Assign team",
    subtitle: "Choose who will run this job, or assign later from the Jobs board.",
  },
  {
    title: "Review & create",
    subtitle: "Check everything below, then create the job.",
  },
] as const;

type StepKind =
  | "customer"
  | "service"
  | "address"
  | "schedule"
  | "assign"
  | "review";

type StepDef = {
  kind: StepKind;
  title: string;
  subtitle: string;
};

function buildStepFlow(
  variant: "inspection" | "job",
  calendarFlow: boolean,
): StepDef[] {
  const isJob = variant === "job";
  if (calendarFlow || isJob) {
    return [
      {
        kind: "customer",
        title: "Customer details",
        subtitle:
          "Search for an existing customer, then confirm contact details and the visit address.",
      },
      {
        kind: "service",
        title: isJob ? JOB_STEPS[0].title : STEPS[0].title,
        subtitle: isJob ? JOB_STEPS[0].subtitle : STEPS[0].subtitle,
      },
      {
        kind: "schedule",
        title: isJob ? JOB_STEPS[2].title : STEPS[2].title,
        subtitle:
          calendarFlow && isJob
            ? "Confirm the calendar slot or adjust hourly blocks for this job."
            : calendarFlow
              ? "Confirm the calendar slot or adjust the visit window."
              : isJob
                ? JOB_STEPS[2].subtitle
                : STEPS[2].subtitle,
      },
      {
        kind: "assign",
        title: isJob ? JOB_STEPS[4].title : "Assign inspector",
        subtitle: isJob
          ? JOB_STEPS[4].subtitle
          : "Choose who will run this visit, or assign later from the Requests board.",
      },
      {
        kind: "review",
        title: isJob ? JOB_STEPS[5].title : STEPS[4].title,
        subtitle: isJob ? JOB_STEPS[5].subtitle : STEPS[4].subtitle,
      },
    ];
  }
  return [
    { kind: "service", ...STEPS[0] },
    { kind: "address", ...STEPS[1] },
    { kind: "schedule", ...STEPS[2] },
    { kind: "customer", ...STEPS[3] },
    { kind: "review", ...STEPS[4] },
  ];
}

const EMPTY_ADDRESS: ServiceAddress = {
  street: "",
  suburb: "",
  state: "",
  postcode: "",
};

const INPUT_CLASS =
  "mt-1 w-full min-w-0 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10";

const LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey =
  | "serviceId"
  | "customTitle"
  | "customDescription"
  | "budgetAud"
  | "street"
  | "suburb"
  | "state"
  | "postcode"
  | "preferredSlots"
  | "fullName"
  | "email"
  | "phone";

type FieldErrors = Partial<Record<FieldKey, string>>;

function inputClassName(invalid: boolean): string {
  return `${INPUT_CLASS}${
    invalid
      ? " border-error/70 ring-2 ring-error/15 focus:border-error/70 focus:ring-error/20"
      : ""
  }`;
}

type InspectionFormState = {
  requestType: InspectionRequestType;
  selectedServiceId: string | null;
  customTitle: string;
  customDescription: string;
  customerNotes: string;
  budgetAud: string;
  address: ServiceAddress;
  preferredSlots: InspectionSlot[];
  calendarWindow: {
    date: string;
    startTime: string;
    endTime: string;
  } | null;
  customer: { fullName: string; email: string; phone: string };
};

function computeFieldErrors(
  form: InspectionFormState,
  workingHours: BusinessWorkingHours,
  variant: "inspection" | "job" = "inspection",
  workingHoursLoading = false,
): FieldErrors {
  const errors: FieldErrors = {};

  if (form.requestType === "existing_service") {
    if (!form.selectedServiceId) {
      errors.serviceId = "Select a service from the list.";
    }
  } else {
    const title = form.customTitle.trim();
    if (!title) errors.customTitle = "Job title is required.";
    else if (title.length < 3) {
      errors.customTitle = "Use at least 3 characters.";
    }

    const description = form.customDescription.trim();
    if (!description) {
      errors.customDescription = "Describe the work needed.";
    } else if (description.length < 10) {
      errors.customDescription = `Add more detail (${description.length}/10 characters minimum).`;
    }
  }

  const budget = form.budgetAud.trim();
  if (budget) {
    const cleaned = budget.replace(/[^\d.]/g, "");
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0) {
      errors.budgetAud = "Enter a valid amount (e.g. 2500).";
    }
  }

  const street = form.address.street.trim();
  if (street.length < 3) {
    errors.street =
      street.length === 0
        ? "Street address is required."
        : "Enter at least 3 characters.";
  }

  const suburb = form.address.suburb.trim();
  if (suburb.length < 2) {
    errors.suburb =
      suburb.length === 0 ? "Suburb is required." : "Enter at least 2 characters.";
  }

  const state = form.address.state.trim();
  if (state.length < 2) {
    errors.state =
      state.length === 0 ? "State is required." : "Enter at least 2 characters.";
  }

  const postcode = form.address.postcode.trim();
  if (postcode.length < 4) {
    errors.postcode =
      postcode.length === 0
        ? "Postcode is required."
        : "Enter a 4-digit postcode.";
  } else if (!/^\d{4}$/.test(postcode)) {
    errors.postcode = "Use a 4-digit Australian postcode.";
  }

  if (!workingHoursLoading) {
    if (form.calendarWindow) {
      const windowError = validateCalendarVisitWindow(
        form.calendarWindow.startTime,
        form.calendarWindow.endTime,
        workingHours,
      );
      if (windowError) errors.preferredSlots = windowError;
    } else if (form.preferredSlots.length === 0) {
      errors.preferredSlots = "Pick at least one preferred date.";
    } else {
      for (const slot of form.preferredSlots) {
        if (variant === "job" && !slotTimeIsSelected(slot)) {
          errors.preferredSlots = `Pick an hourly slot for ${formatSlotDate(slot.date)}.`;
          break;
        }
        const start = slot.startTime ?? "08:00";
        const end = slot.endTime ?? defaultCalendarVisitEnd(start, workingHours);
        const windowError = validateCalendarVisitWindow(start, end, workingHours);
        if (windowError) {
          errors.preferredSlots = windowError;
          break;
        }
      }
      if (!errors.preferredSlots) {
        const missingIndex = form.preferredSlots.findIndex((slot) => !slot.date);
        if (missingIndex >= 0) {
          errors.preferredSlots = `Choose a date for option ${missingIndex + 1}.`;
        } else if (
          new Set(form.preferredSlots.map((slot) => slot.date)).size !==
          form.preferredSlots.length
        ) {
          errors.preferredSlots = "Each date must be unique.";
        }
      }
    }
  } else if (!form.calendarWindow && form.preferredSlots.length === 0) {
    errors.preferredSlots = "Pick at least one preferred date.";
  }

  const fullName = form.customer.fullName.trim();
  if (fullName.length < 2) {
    errors.fullName =
      fullName.length === 0
        ? "Full name is required."
        : "Enter at least 2 characters.";
  }

  const email = form.customer.email.trim();
  if (!email) errors.email = "Email is required.";
  else if (!EMAIL_REGEX.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  const phoneDigits = form.customer.phone.replace(/\D/g, "");
  if (!phoneDigits) errors.phone = "Mobile number is required.";
  else if (phoneDigits.length < 6) {
    errors.phone = "Enter a valid mobile number.";
  }

  return errors;
}

function FieldFeedback({
  error,
  hint,
  errorId,
}: {
  error?: string | null;
  hint?: string;
  errorId: string;
}) {
  if (error) {
    return (
      <span
        id={errorId}
        role="alert"
        className="mt-1 flex items-start gap-1 font-body text-[12px] text-error"
      >
        <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[14px]">
          error
        </span>
        {error}
      </span>
    );
  }
  if (hint) {
    return (
      <span className="mt-1 block font-body text-[11px] text-on-surface-variant">
        {hint}
      </span>
    );
  }
  return null;
}

function isAddressComplete(address: ServiceAddress): boolean {
  const postcode = address.postcode.trim();
  return (
    address.street.trim().length >= 3 &&
    address.suburb.trim().length >= 2 &&
    address.state.trim().length >= 2 &&
    /^\d{4}$/.test(postcode)
  );
}

function normalizeBudgetInput(value: string): string {
  let cleaned = value.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot !== -1) {
    cleaned =
      cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
  }
  const [whole, frac = ""] = cleaned.split(".");
  return frac ? `${whole}.${frac.slice(0, 2)}` : whole;
}

function StepHeader({
  step,
  title,
  hint,
}: {
  step: number;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-on-surface font-body text-[12px] font-bold text-surface">
        {step}
      </span>
      <h3 className="font-display text-[15px] font-semibold text-on-surface">
        {title}
      </h3>
      {hint ? (
        <span className="font-body text-[11px] text-on-surface-variant">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function ServiceThumbnail({
  service,
  size = "md",
}: {
  service: Pick<BusinessServiceDetail, "imageUrl" | "businessType" | "name">;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "h-9 w-9 rounded-lg" : "h-11 w-11 rounded-xl";
  const iconClass = size === "sm" ? "text-[18px]" : "text-[22px]";

  return (
    <div
      className={`${sizeClass} shrink-0 overflow-hidden bg-surface-container`}
    >
      {service.imageUrl ? (
        <img
          src={service.imageUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span
            className={`material-symbols-outlined material-symbols-filled text-on-surface-variant ${iconClass}`}
          >
            {iconForBusinessType(service.businessType)}
          </span>
        </div>
      )}
    </div>
  );
}

function ServiceSelectField({
  label,
  services,
  selectedService,
  loading,
  disabled,
  invalid,
  errorMessage,
  onSelect,
  onBlur,
}: {
  label: string;
  services: BusinessServiceDetail[];
  selectedService: BusinessServiceDetail | null;
  loading: boolean;
  disabled?: boolean;
  invalid: boolean;
  errorMessage: string | null;
  onSelect: (serviceId: string) => void;
  onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        onBlur();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open, onBlur]);

  const pickerDisabled = disabled || loading || services.length === 0;

  return (
    <div ref={rootRef} className="relative">
      <span className={LABEL_CLASS}>{label}</span>
      <button
        type="button"
        disabled={pickerDisabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select a service"
        onClick={() => {
          if (pickerDisabled) return;
          setOpen((current) => !current);
        }}
        onBlur={() => {
          if (!open) onBlur();
        }}
        className={`mt-1 flex w-full items-center gap-3 rounded-xl border bg-surface-container-lowest px-3 py-2.5 text-left transition-colors focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 ${
          invalid
            ? "border-error/70 ring-2 ring-error/15"
            : "border-outline-variant/60"
        }`}
      >
        {selectedService ? (
          <>
            <ServiceThumbnail service={selectedService} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-body text-[14px] font-semibold text-on-surface">
                {selectedService.name}
              </span>
              {selectedService.businessType ? (
                <span className="block truncate font-body text-[12px] text-on-surface-variant">
                  {selectedService.businessType}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 font-body text-[14px] text-on-surface-variant">
            {loading ? "Loading services…" : "Select a service"}
          </span>
        )}
        <span className="material-symbols-outlined shrink-0 text-[20px] text-on-surface-variant">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && services.length > 0 ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg"
        >
          {services.map((service) => {
            const selected = selectedService?.id === service.id;
            return (
              <li key={service.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(service.id);
                    setOpen(false);
                    onBlur();
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-container-low ${
                    selected ? "bg-primary/5" : ""
                  }`}
                >
                  <ServiceThumbnail service={service} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-[14px] font-semibold text-on-surface">
                      {service.name}
                    </span>
                    {service.businessType ? (
                      <span className="block truncate font-body text-[12px] text-on-surface-variant">
                        {service.businessType}
                      </span>
                    ) : null}
                  </span>
                  {selected ? (
                    <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[18px] text-primary">
                      check_circle
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <FieldFeedback error={errorMessage} errorId="serviceId-error" />
    </div>
  );
}

function RequestTypeCard({
  icon,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon: string;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`flex w-full min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-primary bg-surface-container-lowest shadow-sm ring-1 ring-primary/20"
          : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          selected
            ? "bg-primary text-on-primary"
            : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[14px] font-semibold text-on-surface">
          {label}
        </span>
        <span className="mt-0.5 block font-body text-[12px] text-on-surface-variant">
          {description}
        </span>
      </span>
      {selected ? (
        <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[20px] text-primary">
          check_circle
        </span>
      ) : null}
    </button>
  );
}

function sortPreferredSlots(slots: InspectionSlot[]): InspectionSlot[] {
  return sortInspectionSlots(slots);
}

function slotTimeIsSelected(slot: InspectionSlot): boolean {
  return isClockTime(slot.startTime) && isClockTime(slot.endTime);
}

function PreferredDayTimeRow({
  slot,
  kind,
  onWindowChange,
  timeZone,
}: {
  slot: InspectionSlot;
  kind: "inspection" | "job";
  onWindowChange: (startTime: string | null, endTime: string | null) => void;
  timeZone?: string | null;
}) {
  const startTime =
    slot.startTime && isClockTime(slot.startTime) ? slot.startTime : null;
  const endTime =
    slot.endTime && isClockTime(slot.endTime) ? slot.endTime : null;
  const isJob = kind === "job";

  return (
    <li className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
      <p className="inline-flex items-center gap-2 font-body text-[12px] font-bold uppercase tracking-wider text-on-surface">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[14px]">schedule</span>
        </span>
        {formatSlotDate(slot.date, timeZone)}
      </p>
      {isJob && !slotTimeIsSelected(slot) ? (
        <p className="mt-2 font-body text-[12px] text-on-surface-variant">
          No time selected yet — tap an hourly slot below.
        </p>
      ) : null}
      <div className="mt-3">
        <AdminDaySchedulePicker
          date={slot.date}
          kind={kind}
          startTime={startTime}
          endTime={endTime}
          hideTimeRangeFields={isJob}
          multiHourSlots={isJob}
          timeZone={timeZone}
          onWindowChange={onWindowChange}
          onStartTimeChange={(nextStart) =>
            onWindowChange(nextStart, defaultCalendarVisitEnd(nextStart))
          }
          onEndTimeChange={(nextEnd) =>
            onWindowChange(startTime, nextEnd)
          }
        />
      </div>
    </li>
  );
}

function JobScheduleGuidelines({
  selectedDayCount,
}: {
  selectedDayCount: number;
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <p className="flex items-start gap-2 font-body text-[13px] font-semibold text-on-surface">
        <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[18px] text-primary">
          info
        </span>
        How to schedule this job
      </p>
      <ul className="mt-2 space-y-1.5 pl-7 font-body text-[12px] leading-relaxed text-on-surface-variant">
        <li>Each hourly slot is one hour on site — select multiple slots for longer work.</li>
        <li>You can select more than one day for multi-day jobs.</li>
        <li>
          Every selected day appears on the calendar with its own hourly slots.
        </li>
      </ul>
      {selectedDayCount > 1 ? (
        <p className="mt-2 rounded-lg border border-primary/15 bg-white/70 px-3 py-2 font-body text-[12px] text-primary">
          {selectedDayCount} days selected — each day will appear on the
          calendar.
        </p>
      ) : null}
    </div>
  );
}

function PreviewSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
      <h4 className="flex items-center gap-2 font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px] text-primary">
          {icon}
        </span>
        {title}
      </h4>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <span className="shrink-0 font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant sm:w-28">
        {label}
      </span>
      <span className="min-w-0 flex-1 font-body text-[14px] text-on-surface whitespace-pre-wrap">
        {value}
      </span>
    </div>
  );
}

function ServiceAddressFields({
  address,
  showFieldError,
  fieldErrorMessage,
  onUpdateAddress,
  onTouchField,
}: {
  address: ServiceAddress;
  showFieldError: (key: FieldKey) => boolean;
  fieldErrorMessage: (key: FieldKey) => string | null;
  onUpdateAddress: <K extends keyof ServiceAddress>(key: K, value: string) => void;
  onTouchField: (key: FieldKey) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className={LABEL_CLASS}>Street address</span>
        <input
          type="text"
          value={address.street}
          onChange={(event) => onUpdateAddress("street", event.target.value)}
          onBlur={() => onTouchField("street")}
          placeholder="e.g. 12 Main Street"
          autoComplete="off"
          className={inputClassName(showFieldError("street"))}
          aria-invalid={showFieldError("street")}
          aria-describedby={
            fieldErrorMessage("street") ? "street-error" : undefined
          }
        />
        <FieldFeedback
          error={fieldErrorMessage("street")}
          errorId="street-error"
        />
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>Suburb</span>
        <input
          type="text"
          value={address.suburb}
          onChange={(event) => onUpdateAddress("suburb", event.target.value)}
          onBlur={() => onTouchField("suburb")}
          placeholder="e.g. Surry Hills"
          autoComplete="off"
          className={inputClassName(showFieldError("suburb"))}
          aria-invalid={showFieldError("suburb")}
          aria-describedby={
            fieldErrorMessage("suburb") ? "suburb-error" : undefined
          }
        />
        <FieldFeedback
          error={fieldErrorMessage("suburb")}
          errorId="suburb-error"
        />
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>State</span>
        <input
          type="text"
          value={address.state}
          onChange={(event) => onUpdateAddress("state", event.target.value)}
          onBlur={() => onTouchField("state")}
          placeholder="e.g. NSW"
          autoComplete="off"
          className={inputClassName(showFieldError("state"))}
          aria-invalid={showFieldError("state")}
          aria-describedby={
            fieldErrorMessage("state") ? "state-error" : undefined
          }
        />
        <FieldFeedback
          error={fieldErrorMessage("state")}
          errorId="state-error"
        />
      </label>
      <label className="block sm:col-span-2 sm:max-w-[12rem]">
        <span className={LABEL_CLASS}>Postcode</span>
        <input
          type="text"
          inputMode="numeric"
          value={address.postcode}
          onChange={(event) =>
            onUpdateAddress(
              "postcode",
              event.target.value.replace(/\D/g, "").slice(0, 4),
            )
          }
          onBlur={() => onTouchField("postcode")}
          placeholder="e.g. 2000"
          autoComplete="off"
          className={inputClassName(showFieldError("postcode"))}
          aria-invalid={showFieldError("postcode")}
          aria-describedby={
            fieldErrorMessage("postcode") ? "postcode-error" : undefined
          }
        />
        <FieldFeedback
          error={fieldErrorMessage("postcode")}
          errorId="postcode-error"
        />
      </label>
    </div>
  );
}

function CustomerDetailsStep({
  form,
  customerSearch,
  showCustomerDropdown,
  filteredCustomers,
  customersLoading,
  includeAddress,
  showFieldError,
  fieldErrorMessage,
  onCustomerSearchChange,
  onCustomerSearchFocus,
  onSelectCustomer,
  onUpdateCustomer,
  onUpdateAddress,
  onTouchField,
}: {
  form: InspectionFormState;
  customerSearch: string;
  showCustomerDropdown: boolean;
  filteredCustomers: CustomerOption[];
  customersLoading: boolean;
  includeAddress: boolean;
  showFieldError: (key: FieldKey) => boolean;
  fieldErrorMessage: (key: FieldKey) => string | null;
  onCustomerSearchChange: (value: string) => void;
  onCustomerSearchFocus: () => void;
  onSelectCustomer: (option: CustomerOption) => void;
  onUpdateCustomer: (
    field: "fullName" | "email" | "phone",
    value: string,
  ) => void;
  onUpdateAddress: <K extends keyof ServiceAddress>(key: K, value: string) => void;
  onTouchField: (key: FieldKey) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <label className="block">
          <span className={LABEL_CLASS}>Customer name</span>
          <input
            type="text"
            value={customerSearch || form.customer.fullName}
            onChange={(event) => onCustomerSearchChange(event.target.value)}
            onFocus={onCustomerSearchFocus}
            onBlur={() => onTouchField("fullName")}
            placeholder="Search or enter name"
            autoComplete="off"
            className={inputClassName(showFieldError("fullName"))}
            aria-invalid={showFieldError("fullName")}
            aria-describedby={
              fieldErrorMessage("fullName") ? "fullName-error" : undefined
            }
          />
        </label>
        {showCustomerDropdown && filteredCustomers.length > 0 ? (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg">
            <li className="border-b border-outline-variant/40 px-3 py-2 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              {customersLoading ? "Loading customers…" : "Existing customers"}
            </li>
            {filteredCustomers.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelectCustomer(option)}
                  className="flex w-full flex-col px-3 py-2.5 text-left transition-colors hover:bg-surface-container-low"
                >
                  <span className="font-body text-[14px] font-semibold text-on-surface">
                    {option.fullName}
                  </span>
                  {option.email ? (
                    <span className="font-body text-[12px] text-on-surface-variant">
                      {option.email}
                    </span>
                  ) : null}
                  {option.phone ? (
                    <span className="font-body text-[12px] text-on-surface-variant">
                      {formatAuPhoneDisplay(option.phone)}
                    </span>
                  ) : null}
                  {formatCustomerAddressLine(option.address) ? (
                    <span className="font-body text-[12px] text-on-surface-variant">
                      {formatCustomerAddressLine(option.address)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <FieldFeedback
          error={fieldErrorMessage("fullName")}
          errorId="fullName-error"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLASS}>Mobile number</span>
          <AuPhoneInput
            value={form.customer.phone}
            onChange={(value) => onUpdateCustomer("phone", value)}
            autoComplete="off"
            className="mt-1"
          />
          <FieldFeedback
            error={fieldErrorMessage("phone")}
            errorId="phone-error"
          />
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>Email</span>
          <input
            type="email"
            value={form.customer.email}
            onChange={(event) => onUpdateCustomer("email", event.target.value)}
            onBlur={() => onTouchField("email")}
            placeholder="you@example.com"
            autoComplete="off"
            className={inputClassName(showFieldError("email"))}
            aria-invalid={showFieldError("email")}
            aria-describedby={
              fieldErrorMessage("email") ? "email-error" : undefined
            }
          />
          <FieldFeedback
            error={fieldErrorMessage("email")}
            errorId="email-error"
          />
        </label>
      </div>

      {includeAddress ? (
        <div className="border-t border-outline-variant/40 pt-4">
          <p className={LABEL_CLASS}>Service address</p>
          <div className="mt-3">
            <ServiceAddressFields
              address={form.address}
              showFieldError={showFieldError}
              fieldErrorMessage={fieldErrorMessage}
              onUpdateAddress={onUpdateAddress}
              onTouchField={onTouchField}
            />
          </div>
        </div>
      ) : null}

      <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container/50 px-3 py-2.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
        {includeAddress
          ? "Pick an existing customer to pre-fill their details and address, or enter everything manually. A customer account is created automatically when the email is new."
          : "Pick an existing customer to pre-fill their details, or enter new contact info. A customer account is created automatically when the email is new."}
      </p>
    </div>
  );
}

function InspectionPreview({
  form,
  selectedServiceName,
  timeZone,
  variant = "inspection",
  assignTo = null,
  staffName = null,
  showAssignment = false,
  reviewStepNumber = 5,
}: {
  form: InspectionFormState;
  selectedServiceName: string | null;
  timeZone?: string | null;
  variant?: "inspection" | "job";
  assignTo?: "owner" | "staff" | null;
  staffName?: string | null;
  showAssignment?: boolean;
  reviewStepNumber?: number;
}) {
  const jobSummary =
    form.requestType === "existing_service"
      ? selectedServiceName ?? "Selected service"
      : form.customTitle.trim();

  return (
    <div className="space-y-4">
      <StepHeader
        step={reviewStepNumber}
        title="Review & create"
      />

      <PreviewSection title="Job details" icon="handyman">
        <PreviewRow
          label="Type"
          value={
            form.requestType === "existing_service"
              ? "Existing service"
              : "Custom quotation"
          }
        />
        <PreviewRow label="Summary" value={jobSummary} />
        {form.requestType === "custom_quote" ? (
          <PreviewRow label="Scope" value={form.customDescription.trim()} />
        ) : null}
        {form.customerNotes.trim() ? (
          <PreviewRow label="Notes" value={form.customerNotes.trim()} />
        ) : null}
        {form.budgetAud.trim() ? (
          <PreviewRow label="Budget" value={`Aus $ ${form.budgetAud.trim()}`} />
        ) : null}
      </PreviewSection>

      <PreviewSection title="Service address" icon="location_on">
        <PreviewRow label="Address" value={formatAddress(form.address)} />
      </PreviewSection>

      <PreviewSection
        title={variant === "job" ? "Schedule" : "Preferred visits"}
        icon="event"
      >
        <ul className="space-y-2">
          {sortPreferredSlots(form.preferredSlots).map((slot, index) => (
            <li
              key={`${slot.date}-${slot.timeRange}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-white px-3 py-2 font-body text-[13px] text-on-surface"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                {index + 1}
              </span>
              <span>
                {variant === "job" && index === 0 ? (
                  <span className="mr-1.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    Day {index + 1}
                  </span>
                ) : variant === "job" ? (
                  <span className="mr-1.5 rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
                    Day {index + 1}
                  </span>
                ) : null}
                {formatSlotDate(slot.date, timeZone)} ·{" "}
                {formatVisitWindow(slot.startTime, slot.endTime) ??
                  TIME_RANGE_LABELS[slot.timeRange]}
              </span>
            </li>
          ))}
        </ul>
        {variant === "job" && form.preferredSlots.length > 1 ? (
          <p className="mt-2 font-body text-[11px] text-on-surface-variant">
            All {form.preferredSlots.length} days will appear on the calendar.
          </p>
        ) : null}
      </PreviewSection>

      {showAssignment ? (
        <PreviewSection title="Assignment" icon="groups">
          <PreviewRow
            label="Assigned to"
            value={
              assignTo === "owner"
                ? "You (business owner)"
                : assignTo === "staff"
                  ? staffName ?? "Selected team member"
                  : variant === "job"
                    ? "Unassigned — assign later from Jobs"
                    : "Unassigned — assign later from Requests"
            }
          />
        </PreviewSection>
      ) : null}

      <PreviewSection title="Customer" icon="person">
        <PreviewRow label="Name" value={form.customer.fullName.trim()} />
        <PreviewRow
          label="Mobile"
          value={formatAuPhoneDisplay(form.customer.phone)}
        />
        <PreviewRow label="Email" value={form.customer.email.trim()} />
      </PreviewSection>

      <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container/50 px-3 py-2.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
        A customer account will be created if this email is new. The customer
        receives a welcome email (with login details when applicable) and an
        request confirmation.
      </p>
    </div>
  );
}

function createInitialForm(
  calendarWindow?: CalendarSlotSelection | null,
  variant: "inspection" | "job" = "inspection",
) {
  const window = calendarWindow?.date?.trim()
    ? {
        date: calendarWindow.date,
        startTime: calendarWindow.startTime,
        endTime: calendarWindow.endTime,
      }
    : null;

  return {
    requestType: (variant === "job"
      ? "existing_service"
      : "custom_quote") as InspectionRequestType,
    selectedServiceId: null as string | null,
    customTitle: "",
    customDescription: "",
    customerNotes: "",
    budgetAud: "",
    address: { ...EMPTY_ADDRESS },
    preferredSlots: window
      ? [
          {
            date: window.date,
            timeRange: calendarVisitTimeRange(window.startTime),
            startTime: window.startTime,
            endTime: window.endTime,
          },
        ]
      : ([] as InspectionSlot[]),
    calendarWindow: window,
    customer: { fullName: "", email: "", phone: "" },
  };
}

export function AddInspectionModal({
  open,
  onClose,
  onCreated,
  initialCalendarWindow = null,
  initialPreferredSlot = null,
  variant = "inspection",
}: Props) {
  const resolvedCalendarWindow =
    initialCalendarWindow ??
    (initialPreferredSlot?.date
      ? {
          date: initialPreferredSlot.date,
          startTime: "08:00",
          endTime: "09:00",
          timeRange: initialPreferredSlot.timeRange,
        }
      : null);
  const isCalendarFlow = Boolean(resolvedCalendarWindow?.date?.trim());
  const customerFirstFlow = isCalendarFlow || variant === "job";
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const { requests, loading: customersLoading } = useInspectionRequests();
  const { bookings } = useBookings();
  const { staff, loading: staffLoading, reload: reloadStaff } =
    useBusinessStaffSummary();
  const { workingHours, loading: workingHoursLoading } =
    useBusinessWorkingHours();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(createInitialForm);
  const [assignTo, setAssignTo] = useState<"owner" | "staff" | null>(null);
  const [staffId, setStaffId] = useState("");
  const [services, setServices] = useState<BusinessServiceDetail[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [workingDayPage, setWorkingDayPage] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const stepFlow = useMemo(
    () => buildStepFlow(variant, isCalendarFlow),
    [variant, isCalendarFlow],
  );
  const currentStep = stepFlow[step - 1];
  const currentKind = currentStep?.kind ?? "service";
  const showAssignmentStep = stepFlow.some((entry) => entry.kind === "assign");

  const customerOptions = useMemo(
    () => buildCustomerOptions(requests, bookings),
    [requests, bookings],
  );
  const filteredCustomers = useMemo(
    () => filterCustomerOptions(customerOptions, customerSearch),
    [customerOptions, customerSearch],
  );

  const activeServices = useMemo(
    () => services.filter((service) => service.isActive),
    [services],
  );

  const selectedService = useMemo(
    () =>
      activeServices.find((service) => service.id === form.selectedServiceId) ??
      null,
    [activeServices, form.selectedServiceId],
  );

  const timeZone = profile?.timezone;
  const minDate = useMemo(() => todayIso(timeZone), [timeZone]);

  const reset = useCallback(
    (
      calendarWindow?: CalendarSlotSelection | null,
      modalVariant: typeof variant = variant,
    ) => {
      setStep(1);
      setForm(createInitialForm(calendarWindow ?? null, modalVariant));
      setAssignTo(null);
      setStaffId("");
      setTouched({});
      setError(null);
      setSubmitting(false);
      setSuccess(false);
      setWorkingDayPage(0);
      setCustomerSearch("");
      setShowCustomerDropdown(false);
    },
    [variant],
  );

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  useEffect(() => {
    if (!open) return;
    reset(resolvedCalendarWindow, variant);
  }, [open, resolvedCalendarWindow, variant, reset]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) handleClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, submitting, handleClose]);

  useEffect(() => {
    if (!open || !user) return;

    let cancelled = false;
    setServicesLoading(true);

    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/services", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await response.json()) as {
          ok?: boolean;
          services?: BusinessServiceDetail[];
        };
        if (!cancelled && response.ok && data.ok && data.services) {
          setServices(data.services);
          if (data.services.some((service) => service.isActive)) {
            setForm((prev) => ({
              ...prev,
              requestType: "existing_service",
            }));
          }
        }
      } catch {
        /* non-fatal — custom quote still works */
      } finally {
        if (!cancelled) setServicesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user]);

  useEffect(() => {
    if (!open || !showAssignmentStep) return;
    void reloadStaff();
  }, [open, showAssignmentStep, reloadStaff]);

  const serviceValid =
    form.requestType === "existing_service"
      ? form.selectedServiceId !== null
      : form.customTitle.trim().length >= 3 &&
        form.customDescription.trim().length >= 10;

  const addressValid = isAddressComplete(form.address);

  const customerValid =
    form.customer.fullName.trim().length >= 2 &&
    EMAIL_REGEX.test(form.customer.email.trim()) &&
    form.customer.phone.replace(/\D/g, "").length >= 6;

  const scheduleValid = workingHoursLoading
    ? form.calendarWindow
      ? isClockTime(form.calendarWindow.startTime) &&
        isClockTime(form.calendarWindow.endTime)
      : form.preferredSlots.length > 0 &&
        form.preferredSlots.every((slot) => Boolean(slot.date.trim()))
    : form.calendarWindow
      ? variant === "job"
        ? isClockTime(form.calendarWindow.startTime) &&
          isClockTime(form.calendarWindow.endTime) &&
          validateCalendarVisitWindow(
            form.calendarWindow.startTime,
            form.calendarWindow.endTime,
            workingHours,
          ) === null
        : validateCalendarVisitWindow(
            form.calendarWindow.startTime,
            form.calendarWindow.endTime,
            workingHours,
          ) === null
      : form.preferredSlots.length > 0 &&
        form.preferredSlots.every((slot) => {
          if (!slot.date.trim()) return false;
          if (variant === "job" && !slotTimeIsSelected(slot)) return false;
          const start = slot.startTime ?? "08:00";
          const end = slot.endTime ?? defaultCalendarVisitEnd(start, workingHours);
          return validateCalendarVisitWindow(start, end, workingHours) === null;
        }) &&
        new Set(form.preferredSlots.map((slot) => slot.date)).size ===
          form.preferredSlots.length;

  function updateCalendarWindowTimes(
    startTime: string | null,
    endTime: string | null,
  ) {
    setForm((prev) => {
      if (!prev.calendarWindow) return prev;
      if (!startTime || !endTime) {
        return {
          ...prev,
          calendarWindow: {
            ...prev.calendarWindow,
            startTime: "",
            endTime: "",
          },
          preferredSlots: [
            {
              date: prev.calendarWindow.date,
              timeRange: "morning",
              startTime: null,
              endTime: null,
            },
          ],
        };
      }
      return {
        ...prev,
        calendarWindow: {
          ...prev.calendarWindow,
          startTime,
          endTime,
        },
        preferredSlots: [
          {
            date: prev.calendarWindow.date,
            timeRange: calendarVisitTimeRange(startTime),
            startTime,
            endTime,
          },
        ],
      };
    });
  }

  function updateCalendarWindow(
    patch: Partial<NonNullable<InspectionFormState["calendarWindow"]>>,
  ) {
    setForm((prev) => {
      if (!prev.calendarWindow) return prev;
      const nextWindow = { ...prev.calendarWindow, ...patch };
      return {
        ...prev,
        calendarWindow: nextWindow,
        preferredSlots: [
          {
            date: nextWindow.date,
            timeRange: calendarVisitTimeRange(nextWindow.startTime),
            startTime: nextWindow.startTime,
            endTime: nextWindow.endTime,
          },
        ],
      };
    });
  }

  const assignValid =
    !showAssignmentStep ||
    assignTo !== "staff" ||
    (staffId.trim().length > 0 && staff.some((member) => member.id === staffId));

  const assignmentSchedule = useMemo(() => {
    if (form.calendarWindow?.date) {
      return {
        date: form.calendarWindow.date,
        startTime: form.calendarWindow.startTime || null,
        endTime: form.calendarWindow.endTime || null,
      };
    }
    const first = sortInspectionSlots(form.preferredSlots)[0];
    if (!first?.date) {
      return { date: null, startTime: null, endTime: null };
    }
    return {
      date: first.date,
      startTime: first.startTime ?? null,
      endTime: first.endTime ?? null,
    };
  }, [form.calendarWindow, form.preferredSlots]);

  const selectedStaffName = useMemo(() => {
    if (assignTo !== "staff" || !staffId) return null;
    return staff.find((member) => member.id === staffId)?.fullName ?? null;
  }, [assignTo, staff, staffId]);

  const fieldErrors = useMemo(
    () => computeFieldErrors(form, workingHours, variant, workingHoursLoading),
    [form, workingHours, variant, workingHoursLoading],
  );

  const showFieldError = useCallback(
    (key: FieldKey) => Boolean(touched[key] && fieldErrors[key]),
    [touched, fieldErrors],
  );

  const fieldErrorMessage = useCallback(
    (key: FieldKey) => (touched[key] ? fieldErrors[key] ?? null : null),
    [touched, fieldErrors],
  );

  const touchField = useCallback((key: FieldKey) => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const touchStepFields = useCallback(
    (stepNum: number) => {
      const kind = stepFlow[stepNum - 1]?.kind;
      setTouched((prev) => {
        const next = { ...prev };
        if (kind === "service") {
          if (form.requestType === "existing_service") next.serviceId = true;
          else {
            next.customTitle = true;
            next.customDescription = true;
          }
          if (form.budgetAud.trim()) next.budgetAud = true;
        } else if (kind === "address") {
          next.street = true;
          next.suburb = true;
          next.state = true;
          next.postcode = true;
        } else if (kind === "schedule") {
          next.preferredSlots = true;
        } else if (kind === "customer") {
          next.fullName = true;
          next.email = true;
          next.phone = true;
          if (customerFirstFlow) {
            next.street = true;
            next.suburb = true;
            next.state = true;
            next.postcode = true;
          }
        }
        return next;
      });
    },
    [form.requestType, form.budgetAud, stepFlow, customerFirstFlow],
  );

  const stepIsValid = useMemo(() => {
    switch (currentKind) {
      case "customer":
        return customerFirstFlow
          ? customerValid && addressValid
          : customerValid;
      case "service":
        return serviceValid;
      case "address":
        return addressValid;
      case "schedule":
        return scheduleValid;
      case "assign":
        return assignValid;
      case "review":
        return true;
      default:
        return false;
    }
  }, [
    currentKind,
    customerFirstFlow,
    customerValid,
    serviceValid,
    addressValid,
    scheduleValid,
    assignValid,
  ]);

  const canContinue = stepIsValid;

  function updateAddress<K extends keyof ServiceAddress>(key: K, value: string) {
    setForm((prev) => ({
      ...prev,
      address: { ...prev.address, [key]: value },
    }));
    setError(null);
  }

  function updateCustomer(
    field: "fullName" | "email" | "phone",
    value: string,
  ) {
    const next = field === "phone" ? toAuLocalPhoneDigits(value) : value;
    setForm((prev) => ({
      ...prev,
      customer: { ...prev.customer, [field]: next },
    }));
    setError(null);
  }

  function handleCustomerSearchChange(value: string) {
    setCustomerSearch(value);
    setForm((prev) => ({
      ...prev,
      customer: { ...prev.customer, fullName: value },
    }));
    setShowCustomerDropdown(true);
    setError(null);
  }

  function selectCustomer(option: CustomerOption) {
    const nextAddress = option.address
      ? { ...option.address }
      : { street: "", suburb: "", state: "", postcode: "" };
    setForm((prev) => ({
      ...prev,
      customer: {
        fullName: option.fullName,
        email: option.email,
        phone: option.phone,
      },
      address: hasUsableCustomerAddress(option.address)
        ? nextAddress
        : prev.address,
    }));
    setCustomerSearch(option.fullName);
    setShowCustomerDropdown(false);
    setError(null);
  }

  const selectedPreferredDates = useMemo(
    () => form.preferredSlots.map((slot) => slot.date).filter(Boolean),
    [form.preferredSlots],
  );

  function togglePreferredDay(iso: string) {
    setForm((prev) => {
      const exists = prev.preferredSlots.some((slot) => slot.date === iso);
      if (exists) {
        return {
          ...prev,
          preferredSlots: prev.preferredSlots.filter((slot) => slot.date !== iso),
        };
      }
      if (prev.preferredSlots.length >= (variant === "job" ? 5 : 3)) return prev;
      const newSlot: InspectionSlot =
        variant === "job"
          ? {
              date: iso,
              timeRange: "morning",
              startTime: null,
              endTime: null,
            }
          : {
              date: iso,
              timeRange: calendarVisitTimeRange("08:00"),
              startTime: "08:00",
              endTime: "09:00",
            };
      return {
        ...prev,
        preferredSlots: sortPreferredSlots([...prev.preferredSlots, newSlot]),
      };
    });
    setError(null);
  }

  function updateSlotWindow(
    index: number,
    startTime: string | null,
    endTime: string | null,
  ) {
    setForm((prev) => ({
      ...prev,
      preferredSlots: prev.preferredSlots.map((slot, idx) =>
        idx === index
          ? startTime && endTime
            ? {
                ...slot,
                startTime,
                endTime,
                timeRange: calendarVisitTimeRange(startTime),
              }
            : {
                ...slot,
                startTime: null,
                endTime: null,
                timeRange: "morning",
              }
          : slot,
      ),
    }));
    setError(null);
  }

  function goNext() {
    if (!canContinue) {
      touchStepFields(step);
      const stepError =
        currentKind === "service"
          ? fieldErrors.serviceId ??
            fieldErrors.customTitle ??
            fieldErrors.customDescription ??
            fieldErrors.budgetAud
          : currentKind === "address"
            ? fieldErrors.street ??
              fieldErrors.suburb ??
              fieldErrors.state ??
              fieldErrors.postcode
            : currentKind === "schedule"
              ? fieldErrors.preferredSlots
              : currentKind === "customer"
                ? fieldErrors.fullName ??
                  fieldErrors.email ??
                  fieldErrors.phone ??
                  (customerFirstFlow
                    ? fieldErrors.street ??
                      fieldErrors.suburb ??
                      fieldErrors.state ??
                      fieldErrors.postcode
                    : null)
                : currentKind === "assign" &&
                    assignTo === "staff" &&
                    !staffId
                  ? "Choose a team member to assign."
                  : null;
      setError(
        stepError ?? "Please fix the highlighted fields before continuing.",
      );
      return;
    }
    setError(null);
    if (step < stepFlow.length) setStep(step + 1);
  }

  function goBack() {
    setError(null);
    if (step > 1) setStep(step - 1);
  }

  async function submit() {
    if (!user || !customerValid || (customerFirstFlow && !addressValid)) {
      setError(
        customerFirstFlow
          ? "Enter valid customer contact details and service address."
          : "Enter valid customer contact details.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    const schedulePayload = form.calendarWindow
      ? {
          calendarSchedule: form.calendarWindow,
          preferredSlots: [
            {
              date: form.calendarWindow.date,
              timeRange: calendarVisitTimeRange(form.calendarWindow.startTime),
              startTime: form.calendarWindow.startTime,
              endTime: form.calendarWindow.endTime,
            },
          ],
        }
      : {
          preferredSlots: form.preferredSlots.map((slot) => ({
            date: slot.date,
            timeRange:
              slot.timeRange ??
              calendarVisitTimeRange(slot.startTime ?? "08:00"),
            startTime: slot.startTime ?? "08:00",
            endTime:
              slot.endTime ??
              defaultCalendarVisitEnd(slot.startTime ?? "08:00"),
          })),
        };

    const sharedBody = {
      requestType: form.requestType,
      serviceId:
        form.requestType === "existing_service"
          ? form.selectedServiceId
          : null,
      customRequest:
        form.requestType === "custom_quote"
          ? {
              title: form.customTitle.trim(),
              description: form.customDescription.trim(),
            }
          : null,
      customer: {
        fullName: form.customer.fullName.trim(),
        email: form.customer.email.trim().toLowerCase(),
        phone: form.customer.phone,
      },
      address: form.address,
      ...schedulePayload,
      customerNotes: form.customerNotes.trim() || null,
      budgetAud: form.budgetAud.trim() || null,
    };

    const isJob = variant === "job";
    const jobBody =
      isJob && assignTo
        ? {
            assignTo,
            ...(assignTo === "staff" ? { staffId } : {}),
          }
        : isJob
          ? { assignTo: "none" }
          : {};

    try {
      const token = await user.getIdToken();
      const response = await fetch(isJob ? "/api/jobs" : "/api/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...sharedBody,
          ...jobBody,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        requestId?: string;
        jobId?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(
          payload.error ??
            (isJob ? "Could not create job." : "Could not create request."),
        );
      }

      if (!isJob && assignTo && payload.requestId) {
        const assignResponse = await fetch(
          `/api/requests/${payload.requestId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              action: "assign",
              assignTo,
              ...(assignTo === "staff" ? { staffId } : {}),
            }),
          },
        );
        const assignPayload = (await assignResponse.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!assignResponse.ok || !assignPayload.ok) {
          throw new Error(
            assignPayload.error ??
              "Request created, but the inspector could not be assigned.",
          );
        }
      }

      setSuccess(true);
      onCreated?.(payload.jobId ?? payload.requestId ?? "");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : variant === "job"
            ? "Could not create job."
            : "Could not create request.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const current = currentStep ?? stepFlow[0];
  const progressPercent = Math.round((step / stepFlow.length) * 100);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close add inspection"
        onClick={handleClose}
        disabled={submitting}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-inspection-title"
        className="relative z-10 grid h-[94dvh] max-h-[94dvh] w-full max-w-3xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:h-[min(92dvh,calc(100dvh-2rem))] sm:max-h-[min(92dvh,calc(100dvh-2rem))] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
              Step {step} of {stepFlow.length}
            </p>
            <h2
              id="add-inspection-title"
              className="font-display text-headline-sm font-semibold text-on-surface"
            >
              {variant === "job" ? "Add job" : "Add inspection"}
            </h2>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {current.subtitle}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant sm:max-w-md">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-50"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
          {success ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <span className="material-symbols-outlined material-symbols-filled text-[32px]">
                  check_circle
                </span>
              </span>
              <h3 className="mt-4 font-display text-headline-sm font-semibold text-on-surface">
                {variant === "job" ? "Job created" : "Request created"}
              </h3>
              <p className="mt-2 max-w-sm font-body text-body-md text-on-surface-variant">
                {variant === "job"
                  ? form.preferredSlots.length > 1
                    ? "The job is on your board and all selected days appear on the calendar. Inspection and quotation steps are already complete — issue an invoice after the work is done."
                    : "The job is scheduled on your board and calendar. The inspection and quotation steps are already marked complete — issue an invoice after the work is done."
                  : "The request is now on your board. You can review it, assign an inspector, and confirm a visit time."}
              </p>
            </div>
          ) : (
            <>
              {error ? (
                <div className="mb-5 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
                  <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                    error
                  </span>
                  <span>{error}</span>
                </div>
              ) : null}

              {currentKind === "customer" ? (
                <div className="space-y-4">
                  <StepHeader
                    step={step}
                    title={current.title}
                    hint="Required"
                  />
                  <CustomerDetailsStep
                    form={form}
                    customerSearch={customerSearch}
                    showCustomerDropdown={showCustomerDropdown}
                    filteredCustomers={filteredCustomers}
                    customersLoading={customersLoading}
                    includeAddress={customerFirstFlow}
                    showFieldError={showFieldError}
                    fieldErrorMessage={fieldErrorMessage}
                    onCustomerSearchChange={handleCustomerSearchChange}
                    onCustomerSearchFocus={() => setShowCustomerDropdown(true)}
                    onSelectCustomer={selectCustomer}
                    onUpdateCustomer={updateCustomer}
                    onUpdateAddress={updateAddress}
                    onTouchField={touchField}
                  />
                </div>
              ) : null}

              {currentKind === "service" ? (
                <div className="space-y-4">
                  <StepHeader step={step} title={current.title} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <RequestTypeCard
                      icon="format_list_bulleted"
                      label="Request an existing service"
                      description="Pick from the services this business offers."
                      selected={form.requestType === "existing_service"}
                      disabled={servicesLoading || activeServices.length === 0}
                      onSelect={() => {
                        setForm((prev) => ({
                          ...prev,
                          requestType: "existing_service",
                        }));
                        setError(null);
                      }}
                    />
                    <RequestTypeCard
                      icon="request_quote"
                      label="Custom quotation request"
                      description="Describe the work and we'll inspect and quote."
                      selected={form.requestType === "custom_quote"}
                      onSelect={() => {
                        setForm((prev) => ({
                          ...prev,
                          requestType: "custom_quote",
                        }));
                        setError(null);
                      }}
                    />
                  </div>

                  {form.requestType === "existing_service" ? (
                    activeServices.length > 0 || servicesLoading ? (
                      <ServiceSelectField
                        label={
                          variant === "job" ? "Service" : "Existing service"
                        }
                        services={activeServices}
                        selectedService={selectedService}
                        loading={servicesLoading}
                        disabled={activeServices.length === 0}
                        invalid={showFieldError("serviceId")}
                        errorMessage={fieldErrorMessage("serviceId")}
                        onSelect={(serviceId) => {
                          setForm((prev) => ({
                            ...prev,
                            selectedServiceId: serviceId,
                          }));
                          touchField("serviceId");
                          setError(null);
                        }}
                        onBlur={() => touchField("serviceId")}
                      />
                    ) : (
                      <p className="font-body text-body-md text-on-surface-variant">
                        No active services yet — use a custom quotation request.
                      </p>
                    )
                  ) : (
                    <div className="grid gap-3">
                      <label className="block">
                        <span className={LABEL_CLASS}>Job title</span>
                        <input
                          type="text"
                          value={form.customTitle}
                          onChange={(event) => {
                            setForm((prev) => ({
                              ...prev,
                              customTitle: event.target.value,
                            }));
                            setError(null);
                          }}
                          onBlur={() => touchField("customTitle")}
                          placeholder="e.g. Replace kitchen tap and check leak"
                          className={inputClassName(showFieldError("customTitle"))}
                          maxLength={120}
                          aria-invalid={showFieldError("customTitle")}
                          aria-describedby={
                            fieldErrorMessage("customTitle")
                              ? "customTitle-error"
                              : undefined
                          }
                        />
                        <FieldFeedback
                          error={fieldErrorMessage("customTitle")}
                          errorId="customTitle-error"
                        />
                      </label>
                      <label className="block">
                        <span className={LABEL_CLASS}>What needs doing?</span>
                        <textarea
                          value={form.customDescription}
                          onChange={(event) => {
                            setForm((prev) => ({
                              ...prev,
                              customDescription: event.target.value,
                            }));
                            setError(null);
                          }}
                          onBlur={() => touchField("customDescription")}
                          rows={4}
                          placeholder="Tell us the scope, materials involved, urgency, etc."
                          className={`${inputClassName(showFieldError("customDescription"))} resize-y`}
                          maxLength={1500}
                          aria-invalid={showFieldError("customDescription")}
                          aria-describedby="customDescription-feedback"
                        />
                        <FieldFeedback
                          error={fieldErrorMessage("customDescription")}
                          hint={
                            !fieldErrorMessage("customDescription")
                              ? `At least 10 characters (${form.customDescription.trim().length}/10).`
                              : undefined
                          }
                          errorId="customDescription-feedback"
                        />
                      </label>
                    </div>
                  )}

                  <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                    <p className={LABEL_CLASS}>Additional details</p>
                    <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                      Optional — helps the team prepare for the visit or quote.
                    </p>
                    <div className="mt-3 grid gap-3">
                      <label className="block">
                        <span className={LABEL_CLASS}>Notes</span>
                        <textarea
                          value={form.customerNotes}
                          onChange={(event) => {
                            setForm((prev) => ({
                              ...prev,
                              customerNotes: event.target.value,
                            }));
                            setError(null);
                          }}
                          rows={3}
                          placeholder="Access instructions, urgency, materials, anything else we should know…"
                          className={`${INPUT_CLASS} resize-y`}
                          maxLength={2000}
                        />
                      </label>
                      <label className="block">
                        <span className={LABEL_CLASS}>Budget</span>
                        <div className="relative mt-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 font-body text-[14px] font-semibold text-on-surface">
                            Aus $
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.budgetAud}
                            onChange={(event) => {
                              setForm((prev) => ({
                                ...prev,
                                budgetAud: normalizeBudgetInput(
                                  event.target.value,
                                ),
                              }));
                              setError(null);
                            }}
                            onBlur={() => touchField("budgetAud")}
                            placeholder="e.g. 2500"
                            className={`${inputClassName(showFieldError("budgetAud"))} mt-0 pl-[3.65rem] pr-3`}
                            maxLength={12}
                            aria-invalid={showFieldError("budgetAud")}
                            aria-describedby="budgetAud-feedback"
                          />
                        </div>
                        <FieldFeedback
                          error={fieldErrorMessage("budgetAud")}
                          hint={
                            !fieldErrorMessage("budgetAud")
                              ? "Rough amount the customer has in mind (optional)."
                              : undefined
                          }
                          errorId="budgetAud-feedback"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              {currentKind === "address" ? (
                <div className="space-y-4">
                  <StepHeader
                    step={step}
                    title={current.title}
                    hint="Required"
                  />
                  <ServiceAddressFields
                    address={form.address}
                    showFieldError={showFieldError}
                    fieldErrorMessage={fieldErrorMessage}
                    onUpdateAddress={updateAddress}
                    onTouchField={touchField}
                  />
                </div>
              ) : null}

              {currentKind === "schedule" ? (
                <div className="space-y-4">
                  <StepHeader
                    step={step}
                    title={current.title}
                    hint={
                      variant === "job"
                        ? form.calendarWindow
                          ? "Calendar schedule"
                          : `${selectedPreferredDates.length} day${selectedPreferredDates.length === 1 ? "" : "s"}`
                        : form.calendarWindow
                          ? "Calendar schedule"
                          : `${selectedPreferredDates.length} of 3 days`
                    }
                  />
                  {variant === "job" ? (
                    <JobScheduleGuidelines
                      selectedDayCount={selectedPreferredDates.length}
                    />
                  ) : null}
                  {fieldErrorMessage("preferredSlots") ? (
                    <FieldFeedback
                      error={fieldErrorMessage("preferredSlots")}
                      errorId="preferredSlots-error"
                    />
                  ) : null}

                  {form.calendarWindow ? (
                    <div className="space-y-4 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                      <div>
                        <span className={LABEL_CLASS}>Date</span>
                        <p className="mt-1 font-body text-[15px] font-semibold text-on-surface">
                          {formatSlotDate(form.calendarWindow.date, timeZone)}
                        </p>
                      </div>
                      <AdminDaySchedulePicker
                        date={form.calendarWindow.date}
                        kind={variant === "job" ? "job" : "inspection"}
                        startTime={
                          form.calendarWindow.startTime || null
                        }
                        endTime={form.calendarWindow.endTime || null}
                        hideTimeRangeFields={variant === "job"}
                        multiHourSlots={variant === "job"}
                        timeZone={timeZone}
                        onWindowChange={(start, end) => {
                          touchField("preferredSlots");
                          if (variant === "job") {
                            updateCalendarWindowTimes(start, end);
                            return;
                          }
                          if (start && end) {
                            updateCalendarWindow({ startTime: start, endTime: end });
                          }
                        }}
                        onStartTimeChange={(startTime) => {
                          touchField("preferredSlots");
                          updateCalendarWindow({
                            startTime,
                            endTime: defaultCalendarVisitEnd(startTime),
                          });
                        }}
                        onEndTimeChange={(endTime) => {
                          touchField("preferredSlots");
                          updateCalendarWindow({ endTime });
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                        <SlotDayPicker
                          mode="multiple"
                          selectedIsos={selectedPreferredDates}
                          maxSelections={variant === "job" ? 5 : 3}
                          minDate={minDate}
                          dayPage={workingDayPage}
                          onDayPageChange={setWorkingDayPage}
                          onToggle={(iso) => {
                            touchField("preferredSlots");
                            togglePreferredDay(iso);
                          }}
                          label={
                            variant === "job"
                              ? "Pick one or more days"
                              : "Pick up to 3 days"
                          }
                          dayStripLayout="fit"
                          timeZone={timeZone}
                        />
                        {variant === "job" ? (
                          <p className="mt-3 font-body text-[12px] text-on-surface-variant">
                            You can select more than one day for multi-day jobs.
                            Tap a selected day again to remove it.
                          </p>
                        ) : selectedPreferredDates.length > 0 ? (
                          <p className="mt-3 font-body text-[12px] text-on-surface-variant">
                            Tap a selected day again to remove it.
                          </p>
                        ) : (
                          <p className="mt-3 rounded-xl border border-dashed border-outline-variant/60 bg-white/60 px-3 py-2 font-body text-[12px] text-on-surface-variant">
                            Choose at least one day to continue.
                          </p>
                        )}
                      </div>

                      {selectedPreferredDates.length > 0 ? (
                        <div>
                          <span className={LABEL_CLASS}>
                            {variant === "job"
                              ? "Pick hourly slots for each day"
                              : "Pick a time for each day"}
                          </span>
                          <ul className="mt-2 space-y-3">
                            {sortPreferredSlots(form.preferredSlots).map(
                              (slot) => {
                                const slotIndex = form.preferredSlots.findIndex(
                                  (entry) => entry.date === slot.date,
                                );
                                return (
                                  <PreferredDayTimeRow
                                    key={slot.date}
                                    slot={slot}
                                    kind={variant === "job" ? "job" : "inspection"}
                                    timeZone={timeZone}
                                    onWindowChange={(startTime, endTime) => {
                                      touchField("preferredSlots");
                                      updateSlotWindow(slotIndex, startTime, endTime);
                                    }}
                                  />
                                );
                              },
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {currentKind === "review" ? (
                <InspectionPreview
                  form={form}
                  selectedServiceName={selectedService?.name ?? null}
                  timeZone={timeZone}
                  variant={variant}
                  assignTo={showAssignmentStep ? assignTo : null}
                  staffName={selectedStaffName}
                  showAssignment={showAssignmentStep}
                  reviewStepNumber={step}
                />
              ) : null}

              {currentKind === "assign" ? (
                <div className="space-y-4">
                  <StepHeader
                    step={step}
                    title={current.title}
                    hint="Optional"
                  />
                  <JobAssignPicker
                    staff={staff}
                    staffLoading={staffLoading}
                    assignTo={assignTo}
                    staffId={staffId}
                    disabled={submitting}
                    assignmentDate={assignmentSchedule.date}
                    startTime={assignmentSchedule.startTime}
                    endTime={assignmentSchedule.endTime}
                    timeZone={timeZone}
                    showUnassigned
                    onAssignToChange={setAssignTo}
                    onStaffIdChange={setStaffId}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-variant bg-background px-5 py-4 shadow-[0_-8px_24px_rgba(0,42,150,0.08)] sm:px-6">
          {success ? (
            <button
              type="button"
              onClick={handleClose}
              className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={step === 1 ? handleClose : goBack}
                disabled={submitting}
                className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-50"
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>

              {step < stepFlow.length ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canContinue}
                  className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
                >
                  Continue
                  <span className="material-symbols-outlined text-[18px]">
                    arrow_forward
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[18px]">
                        progress_activity
                      </span>
                      Creating…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">
                        add
                      </span>
                      {variant === "job" ? "Create job" : "Create inspection"}
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
