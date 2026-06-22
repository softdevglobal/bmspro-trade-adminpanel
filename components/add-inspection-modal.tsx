"use client";

import { AdminDaySchedulePicker } from "@/components/admin-day-schedule-picker";
import { AuPhoneInput } from "@/components/au-phone-input";
import {
  calendarVisitTimeRange,
  defaultCalendarVisitEnd,
  validateCalendarVisitWindow,
} from "@/components/calendar-visit-time-range";
import type { CalendarSlotSelection } from "@/lib/calendar/time-slots";
import { SlotDayPicker, todayIso } from "@/components/booking-slot-date-picker";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import type {
  InspectionRequestType,
  InspectionSlot,
  InspectionTimeRange,
} from "@/lib/inspection/types";
import {
  TIME_RANGE_LABELS,
  formatAddress,
  formatSlotDate,
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
    subtitle: "Pick the date and time for this job on site.",
  },
  {
    title: "Contact details",
    subtitle: "Customer contact info for the visit and follow-up.",
  },
  {
    title: "Review & create",
    subtitle: "Check everything below, then create the job.",
  },
] as const;

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

function computeFieldErrors(form: InspectionFormState): FieldErrors {
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

  if (form.calendarWindow) {
    const windowError = validateCalendarVisitWindow(
      form.calendarWindow.startTime,
      form.calendarWindow.endTime,
    );
    if (windowError) errors.preferredSlots = windowError;
  } else if (form.preferredSlots.length === 0) {
    errors.preferredSlots = "Pick at least one preferred date.";
  } else {
    for (const slot of form.preferredSlots) {
      const start = slot.startTime ?? "08:00";
      const end = slot.endTime ?? defaultCalendarVisitEnd(start);
      const windowError = validateCalendarVisitWindow(start, end);
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
  return [...slots].sort((a, b) => a.date.localeCompare(b.date));
}

function PreferredDayTimeRow({
  slot,
  kind,
  onWindowChange,
  timeZone,
}: {
  slot: InspectionSlot;
  kind: "inspection" | "job";
  onWindowChange: (startTime: string, endTime: string) => void;
  timeZone?: string | null;
}) {
  const startTime = slot.startTime ?? "08:00";
  const endTime = slot.endTime ?? defaultCalendarVisitEnd(startTime);

  return (
    <li className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
      <p className="inline-flex items-center gap-2 font-body text-[12px] font-bold uppercase tracking-wider text-on-surface">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[14px]">schedule</span>
        </span>
        {formatSlotDate(slot.date, timeZone)}
      </p>
      <div className="mt-3">
        <AdminDaySchedulePicker
          date={slot.date}
          kind={kind}
          startTime={startTime}
          endTime={endTime}
          onStartTimeChange={(nextStart) =>
            onWindowChange(nextStart, defaultCalendarVisitEnd(nextStart))
          }
          onEndTimeChange={(nextEnd) => onWindowChange(startTime, nextEnd)}
        />
      </div>
    </li>
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

function InspectionPreview({
  form,
  selectedServiceName,
  timeZone,
}: {
  form: InspectionFormState;
  selectedServiceName: string | null;
  timeZone?: string | null;
}) {
  const jobSummary =
    form.requestType === "existing_service"
      ? selectedServiceName ?? "Selected service"
      : form.customTitle.trim();

  return (
    <div className="space-y-4">
      <StepHeader step={5} title="Review & create" />

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

      <PreviewSection title="Preferred visits" icon="event">
        <ul className="space-y-2">
          {form.preferredSlots.map((slot, index) => (
            <li
              key={`${slot.date}-${slot.timeRange}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-outline-variant/40 bg-white px-3 py-2 font-body text-[13px] text-on-surface"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                {index + 1}
              </span>
              <span>
                {formatSlotDate(slot.date, timeZone)} ·{" "}
                {TIME_RANGE_LABELS[slot.timeRange]}
              </span>
            </li>
          ))}
        </ul>
      </PreviewSection>

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
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(createInitialForm);
  const [services, setServices] = useState<BusinessServiceDetail[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [workingDayPage, setWorkingDayPage] = useState(0);

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
      setTouched({});
      setError(null);
      setSubmitting(false);
      setSuccess(false);
      setWorkingDayPage(0);
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

  const step1Valid =
    form.requestType === "existing_service"
      ? form.selectedServiceId !== null
      : form.customTitle.trim().length >= 3 &&
        form.customDescription.trim().length >= 10;

  const step2Valid = isAddressComplete(form.address);

  const step3Valid = form.calendarWindow
    ? validateCalendarVisitWindow(
        form.calendarWindow.startTime,
        form.calendarWindow.endTime,
      ) === null
    : form.preferredSlots.length > 0 &&
      form.preferredSlots.every((slot) => {
        if (!slot.date.trim()) return false;
        const start = slot.startTime ?? "08:00";
        const end = slot.endTime ?? defaultCalendarVisitEnd(start);
        return validateCalendarVisitWindow(start, end) === null;
      }) &&
      new Set(form.preferredSlots.map((slot) => slot.date)).size ===
        form.preferredSlots.length;

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
          },
        ],
      };
    });
  }

  const step4Valid =
    form.customer.fullName.trim().length >= 2 &&
    EMAIL_REGEX.test(form.customer.email.trim()) &&
    form.customer.phone.replace(/\D/g, "").length >= 6;

  const fieldErrors = useMemo(() => computeFieldErrors(form), [form]);

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
      setTouched((prev) => {
        const next = { ...prev };
        if (stepNum === 1) {
          if (form.requestType === "existing_service") next.serviceId = true;
          else {
            next.customTitle = true;
            next.customDescription = true;
          }
          if (form.budgetAud.trim()) next.budgetAud = true;
        } else if (stepNum === 2) {
          next.street = true;
          next.suburb = true;
          next.state = true;
          next.postcode = true;
        } else if (stepNum === 3) {
          next.preferredSlots = true;
        } else if (stepNum === 4) {
          next.fullName = true;
          next.email = true;
          next.phone = true;
        }
        return next;
      });
    },
    [form.requestType, form.budgetAud],
  );

  const canContinue =
    (step === 1 && step1Valid) ||
    (step === 2 && step2Valid) ||
    (step === 3 && step3Valid) ||
    (step === 4 && step4Valid);

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
      if (prev.preferredSlots.length >= 3) return prev;
      return {
        ...prev,
        preferredSlots: sortPreferredSlots([
          ...prev.preferredSlots,
          {
            date: iso,
            timeRange: calendarVisitTimeRange("08:00"),
            startTime: "08:00",
            endTime: "09:00",
          },
        ]),
      };
    });
    setError(null);
  }

  function updateSlotWindow(
    index: number,
    startTime: string,
    endTime: string,
  ) {
    setForm((prev) => ({
      ...prev,
      preferredSlots: prev.preferredSlots.map((slot, idx) =>
        idx === index
          ? {
              ...slot,
              startTime,
              endTime,
              timeRange: calendarVisitTimeRange(startTime),
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
        step === 1
          ? fieldErrors.serviceId ??
            fieldErrors.customTitle ??
            fieldErrors.customDescription ??
            fieldErrors.budgetAud
          : step === 2
            ? fieldErrors.street ??
              fieldErrors.suburb ??
              fieldErrors.state ??
              fieldErrors.postcode
            : step === 3
              ? fieldErrors.preferredSlots
              : fieldErrors.fullName ??
                fieldErrors.email ??
                fieldErrors.phone;
      setError(
        stepError ?? "Please fix the highlighted fields before continuing.",
      );
      return;
    }
    setError(null);
    const totalSteps = variant === "job" ? JOB_STEPS.length : STEPS.length;
    if (step < totalSteps) setStep(step + 1);
  }

  function goBack() {
    setError(null);
    if (step > 1) setStep(step - 1);
  }

  async function submit() {
    if (!user || !step4Valid) {
      setError("Enter valid customer contact details.");
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
            timeRange: slot.timeRange,
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

    try {
      const token = await user.getIdToken();
      const isJob = variant === "job";
      const response = await fetch(isJob ? "/api/jobs" : "/api/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(sharedBody),
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

  const steps = variant === "job" ? JOB_STEPS : STEPS;
  const current = steps[step - 1];
  const progressPercent = Math.round((step / steps.length) * 100);

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
              Step {step} of {steps.length}
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
                  ? "The job is scheduled on your board and calendar. The inspection and quotation steps are already marked complete — issue an invoice after the work is done."
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

              {step === 1 ? (
                <div className="space-y-4">
                  <StepHeader step={1} title={current.title} />
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
                    activeServices.length > 0 ? (
                      <>
                      <ul className="overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest">
                        {activeServices.map((service, index) => {
                          const selected =
                            form.selectedServiceId === service.id;
                          return (
                            <li
                              key={service.id}
                              className={
                                index > 0
                                  ? "border-t border-outline-variant/40"
                                  : ""
                              }
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setForm((prev) => ({
                                    ...prev,
                                    selectedServiceId:
                                      prev.selectedServiceId === service.id
                                        ? null
                                        : service.id,
                                  }));
                                  touchField("serviceId");
                                  setError(null);
                                }}
                                className={`flex w-full items-center gap-3 p-3 text-left transition-colors sm:p-4 ${
                                  selected
                                    ? "bg-primary/5"
                                    : "hover:bg-surface-container"
                                }`}
                              >
                                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-container">
                                  {service.imageUrl ? (
                                    <img
                                      src={service.imageUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                      <span className="material-symbols-outlined material-symbols-filled text-[28px] text-on-surface-variant">
                                        {iconForBusinessType(service.businessType)}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <span className="min-w-0 flex-1">
                                  <span className="block font-body text-[14px] font-semibold text-on-surface">
                                    {service.name}
                                  </span>
                                  <span className="font-body text-[12px] text-on-surface-variant">
                                    {service.businessType}
                                  </span>
                                </span>
                                {selected ? (
                                  <span className="material-symbols-outlined material-symbols-filled text-[20px] text-primary">
                                    check_circle
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {fieldErrorMessage("serviceId") ? (
                        <FieldFeedback
                          error={fieldErrorMessage("serviceId")}
                          errorId="serviceId-error"
                        />
                      ) : null}
                      </>
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

              {step === 2 ? (
                <div className="space-y-4">
                  <StepHeader
                    step={2}
                    title={current.title}
                    hint="Required"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className={LABEL_CLASS}>Street address</span>
                      <input
                        type="text"
                        value={form.address.street}
                        onChange={(event) =>
                          updateAddress("street", event.target.value)
                        }
                        onBlur={() => touchField("street")}
                        placeholder="e.g. 12 Main Street"
                        autoComplete="off"
                        className={inputClassName(showFieldError("street"))}
                        aria-invalid={showFieldError("street")}
                        aria-describedby={
                          fieldErrorMessage("street")
                            ? "street-error"
                            : undefined
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
                        value={form.address.suburb}
                        onChange={(event) =>
                          updateAddress("suburb", event.target.value)
                        }
                        onBlur={() => touchField("suburb")}
                        placeholder="e.g. Surry Hills"
                        autoComplete="off"
                        className={inputClassName(showFieldError("suburb"))}
                        aria-invalid={showFieldError("suburb")}
                        aria-describedby={
                          fieldErrorMessage("suburb")
                            ? "suburb-error"
                            : undefined
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
                        value={form.address.state}
                        onChange={(event) =>
                          updateAddress("state", event.target.value)
                        }
                        onBlur={() => touchField("state")}
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
                        value={form.address.postcode}
                        onChange={(event) =>
                          updateAddress(
                            "postcode",
                            event.target.value.replace(/\D/g, "").slice(0, 4),
                          )
                        }
                        onBlur={() => touchField("postcode")}
                        placeholder="e.g. 2000"
                        autoComplete="off"
                        className={inputClassName(showFieldError("postcode"))}
                        aria-invalid={showFieldError("postcode")}
                        aria-describedby={
                          fieldErrorMessage("postcode")
                            ? "postcode-error"
                            : undefined
                        }
                      />
                      <FieldFeedback
                        error={fieldErrorMessage("postcode")}
                        errorId="postcode-error"
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="space-y-4">
                  <StepHeader
                    step={3}
                    title={current.title}
                    hint={
                      form.calendarWindow
                        ? "Calendar schedule"
                        : `${selectedPreferredDates.length} of 3 days`
                    }
                  />
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
                        startTime={form.calendarWindow.startTime}
                        endTime={form.calendarWindow.endTime}
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
                          maxSelections={3}
                          minDate={minDate}
                          dayPage={workingDayPage}
                          onDayPageChange={setWorkingDayPage}
                          onToggle={(iso) => {
                            touchField("preferredSlots");
                            togglePreferredDay(iso);
                          }}
                          label="Pick up to 3 days"
                          dayStripLayout="fit"
                          timeZone={timeZone}
                        />
                        {selectedPreferredDates.length > 0 ? (
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
                            Pick a time for each day
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

              {step === 5 ? (
                <InspectionPreview
                  form={form}
                  selectedServiceName={selectedService?.name ?? null}
                  timeZone={timeZone}
                />
              ) : null}

              {step === 4 ? (
                <div className="space-y-4">
                  <StepHeader
                    step={4}
                    title={current.title}
                    hint="Required"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className={LABEL_CLASS}>Full name</span>
                      <input
                        type="text"
                        value={form.customer.fullName}
                        onChange={(event) =>
                          updateCustomer("fullName", event.target.value)
                        }
                        onBlur={() => touchField("fullName")}
                        placeholder="e.g. Alex Thompson"
                        autoComplete="off"
                        className={inputClassName(showFieldError("fullName"))}
                        aria-invalid={showFieldError("fullName")}
                        aria-describedby={
                          fieldErrorMessage("fullName")
                            ? "fullName-error"
                            : undefined
                        }
                      />
                      <FieldFeedback
                        error={fieldErrorMessage("fullName")}
                        errorId="fullName-error"
                      />
                    </label>
                    <label className="block">
                      <span className={LABEL_CLASS}>Mobile number</span>
                      <AuPhoneInput
                        value={form.customer.phone}
                        onChange={(value) => updateCustomer("phone", value)}
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
                        onChange={(event) =>
                          updateCustomer("email", event.target.value)
                        }
                        onBlur={() => touchField("email")}
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

              {step < steps.length ? (
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
