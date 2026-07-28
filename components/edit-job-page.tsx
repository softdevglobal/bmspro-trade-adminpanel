"use client";

import { AdminDaySchedulePicker } from "@/components/admin-day-schedule-picker";
import { AuPhoneInput } from "@/components/au-phone-input";
import { SlotDayPicker, todayIso } from "@/components/booking-slot-date-picker";
import { defaultCalendarVisitEnd } from "@/components/calendar-visit-time-range";
import { JobEstimateSelect } from "@/components/job-estimate-select";
import {
  JobInstructionsFields,
  normalizeInstructionTasksForSubmit,
} from "@/components/job-instructions-fields";
import { useAuth } from "@/lib/auth/auth-context";
import {
  endClockFromEstimate,
  estimateMinutesFromTimeRange,
  minutesBetweenClockTimes,
} from "@/lib/bookings/job-estimate";
import type { BookingDetail } from "@/lib/bookings/types";
import { useBookings } from "@/lib/bookings/use-bookings";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import {
  buildCustomerOptions,
  filterCustomerOptions,
  formatCustomerAddressLine,
  type CustomerOption,
} from "@/lib/inspection/customer-options";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  formatAuPhoneDisplay,
  toAuLocalPhoneDigits,
} from "@/lib/phone/au-phone";
import { timeRangeFromStartTime } from "@/lib/inspection/types";
import type { InspectionRequestType } from "@/lib/inspection/types";
import type { BusinessServiceDetail } from "@/lib/onboarding/services/display";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { displayBookingCode } from "@/lib/reference-codes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const INPUT_CLASS =
  "mt-1 w-full min-w-0 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10";

const LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

function SaveSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
      {label}
    </span>
  );
}

function SectionHeader({
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
      <h2 className="font-display text-[15px] font-semibold text-on-surface">
        {title}
      </h2>
      {hint ? (
        <span className="font-body text-[11px] text-on-surface-variant">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function FormSection({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-4 sm:p-5">
      <SectionHeader step={step} title={title} hint={hint} />
      {children}
    </section>
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
    <div className={`${sizeClass} shrink-0 overflow-hidden bg-surface-container`}>
      {service.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
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
  services,
  selectedService,
  loading,
  disabled,
  onSelect,
}: {
  services: BusinessServiceDetail[];
  selectedService: BusinessServiceDetail | null;
  loading: boolean;
  disabled?: boolean;
  onSelect: (serviceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const pickerDisabled = disabled || loading || services.length === 0;

  return (
    <div ref={rootRef} className="relative">
      <span className={LABEL_CLASS}>Service</span>
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
        className="mt-1 flex w-full items-center gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 text-left transition-colors focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
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
    </div>
  );
}

export function EditJobPage({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const timeZone = profile?.timezone;
  const { requests, loading: customersLoading } = useInspectionRequests();
  const { bookings } = useBookings();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookingDetail | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  const [street, setStreet] = useState("");
  const [suburb, setSuburb] = useState("");
  const [state, setState] = useState("");
  const [postcode, setPostcode] = useState("");

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [requestType, setRequestType] =
    useState<InspectionRequestType>("existing_service");
  const [serviceName, setServiceName] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [services, setServices] = useState<BusinessServiceDetail[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [dayPage, setDayPage] = useState(0);
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);

  const [ownerNote, setOwnerNote] = useState("");
  const [instructions, setInstructions] = useState("");
  const [instructionTasks, setInstructionTasks] = useState<string[]>([]);

  const customerOptions = useMemo(
    () => buildCustomerOptions(requests, bookings),
    [requests, bookings],
  );
  const filteredCustomers = useMemo(
    () => filterCustomerOptions(customerOptions, customerSearch),
    [customerOptions, customerSearch],
  );
  const activeServices = useMemo(() => {
    const active = services.filter((service) => service.isActive);
    if (
      selectedServiceId &&
      !active.some((service) => service.id === selectedServiceId)
    ) {
      const current = services.find(
        (service) => service.id === selectedServiceId,
      );
      if (current) return [current, ...active];
      if (serviceName.trim()) {
        return [
          {
            id: selectedServiceId,
            name: serviceName.trim(),
            businessType: booking?.serviceBusinessType ?? "",
            imageUrl: null,
            isActive: false,
          } as BusinessServiceDetail,
          ...active,
        ];
      }
    }
    return active;
  }, [
    services,
    selectedServiceId,
    serviceName,
    booking?.serviceBusinessType,
  ]);
  const selectedService = useMemo(
    () =>
      activeServices.find((service) => service.id === selectedServiceId) ??
      null,
    [activeServices, selectedServiceId],
  );
  const minDate = useMemo(() => todayIso(timeZone), [timeZone]);

  const loadJob = useCallback(async () => {
    if (!user || !jobId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        booking?: BookingDetail;
      };
      if (!response.ok || !data.ok || !data.booking) {
        throw new Error(data.error ?? "Could not load job.");
      }
      const job = data.booking;
      if (job.status === "cancelled" || job.status === "completed") {
        throw new Error("Only active jobs can be edited.");
      }
      setBooking(job);
      setCustomerName(job.customer.fullName ?? "");
      setCustomerEmail(job.customer.email ?? "");
      setCustomerPhone(toAuLocalPhoneDigits(job.customer.phone ?? ""));
      setCustomerSearch(job.customer.fullName ?? "");
      setStreet(job.address.street ?? "");
      setSuburb(job.address.suburb ?? "");
      setState(job.address.state ?? "");
      setPostcode(job.address.postcode ?? "");
      setSelectedServiceId(job.serviceId);
      setRequestType(job.requestType);
      setServiceName(job.serviceName ?? "");
      setCustomTitle(job.customRequest?.title ?? "");
      setCustomDescription(job.customRequest?.description ?? "");
      setDate(job.scheduledSlot?.date ?? "");
      setStartTime(job.scheduledStartTime ?? "10:00");
      setEndTime(job.scheduledEndTime ?? "11:00");
      setEstimatedMinutes(
        job.estimatedDurationMinutes ??
          estimateMinutesFromTimeRange(
            job.scheduledStartTime ?? "10:00",
            job.scheduledEndTime ?? "11:00",
          ) ??
          60,
      );
      setOwnerNote(job.ownerNote ?? "");
      setInstructions(job.jobInstructionsDescription ?? "");
      setInstructionTasks(
        job.jobInstructionsTasks.length > 0 ? [...job.jobInstructionsTasks] : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load job.",
      );
    } finally {
      setLoading(false);
    }
  }, [user, jobId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadJob();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadJob]);

  useEffect(() => {
    if (!user || !booking) return;
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
        }
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setServicesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, booking]);

  useEffect(() => {
    const minutes = minutesBetweenClockTimes(startTime, endTime);
    if (minutes != null) setEstimatedMinutes(minutes);
  }, [startTime, endTime]);

  function selectCustomer(option: CustomerOption) {
    setCustomerName(option.fullName);
    setCustomerSearch(option.fullName);
    setCustomerEmail(option.email);
    setCustomerPhone(toAuLocalPhoneDigits(option.phone));
    if (option.address) {
      setStreet(option.address.street ?? "");
      setSuburb(option.address.suburb ?? "");
      setState(option.address.state ?? "");
      setPostcode(option.address.postcode ?? "");
    }
    setShowCustomerDropdown(false);
    setError(null);
  }

  async function save() {
    if (!user || !booking) return;
    if (customerName.trim().length < 2) {
      setError("Add a customer name.");
      return;
    }
    if (requestType === "existing_service" && !selectedServiceId) {
      setError("Select a service from the list.");
      return;
    }
    if (requestType === "custom_quote" && customTitle.trim().length < 3) {
      setError("Scope of Work must be at least 3 characters.");
      return;
    }
    if (!date) {
      setError("Choose a job date.");
      return;
    }
    if (!startTime || !endTime) {
      setError("Choose both start and end times.");
      return;
    }
    if (startTime >= endTime) {
      setError("The end time must be after the start time.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/jobs/${encodeURIComponent(booking.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "update_details",
            slot: {
              date,
              timeRange: timeRangeFromStartTime(startTime),
            },
            startTime,
            endTime,
            customer: {
              fullName: customerName.trim(),
              email: customerEmail.trim(),
              phone: customerPhone.trim(),
            },
            address: { street, suburb, state, postcode },
            requestType,
            serviceId:
              requestType === "existing_service" ? selectedServiceId : null,
            serviceName:
              requestType === "existing_service"
                ? selectedService?.name ?? serviceName
                : customTitle.trim(),
            customRequest:
              requestType === "custom_quote"
                ? {
                    title: customTitle.trim(),
                    description: customDescription.trim(),
                  }
                : null,
            ownerNote,
            jobInstructionsDescription: instructions,
            jobInstructionsTasks:
              normalizeInstructionTasksForSubmit(instructionTasks),
          }),
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Could not save job.");
      }
      router.push(`/dashboard/jobs?job=${encodeURIComponent(booking.id)}`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save job.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 px-4 py-6 sm:px-6">
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            className="h-28 animate-pulse rounded-2xl border border-outline-variant/40 bg-surface-container-lowest"
          />
        ))}
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="px-4 py-10 text-center sm:px-6">
        <p className="font-body text-[14px] text-on-surface-variant">
          {error ?? "Job not found."}
        </p>
        <Link
          href="/dashboard/jobs"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-body text-[14px] font-semibold text-on-primary"
        >
          Back to jobs
        </Link>
      </div>
    );
  }

  const isExistingService = requestType === "existing_service";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-outline-variant/60 bg-background/95 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/dashboard/jobs?job=${encodeURIComponent(booking.id)}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
              aria-label="Back to jobs"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </Link>
            <div className="min-w-0">
              <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-primary">
                Edit job
              </p>
              <h1 className="truncate font-display text-[18px] font-semibold text-on-surface sm:text-[20px]">
                {displayBookingCode(booking)}
              </h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={submitting}
            className="inline-flex min-w-[5.5rem] items-center justify-center rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {submitting ? <SaveSpinner label="Saving…" /> : "Save"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container sm:mx-6">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-3xl space-y-4 pb-8">
          <FormSection step={1} title="Customer details" hint="Required">
            <div className="relative">
              <label className="block">
                <span className={LABEL_CLASS}>Customer name</span>
                <input
                  type="text"
                  value={customerSearch || customerName}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCustomerSearch(value);
                    setCustomerName(value);
                    setShowCustomerDropdown(true);
                    setError(null);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onBlur={() => {
                    window.setTimeout(() => setShowCustomerDropdown(false), 150);
                  }}
                  placeholder="Search or enter name"
                  autoComplete="off"
                  disabled={submitting}
                  className={INPUT_CLASS}
                />
              </label>
              {showCustomerDropdown && filteredCustomers.length > 0 ? (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg">
                  <li className="border-b border-outline-variant/40 px-3 py-2 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    {customersLoading
                      ? "Loading customers…"
                      : "Existing customers"}
                  </li>
                  {filteredCustomers.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCustomer(option)}
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
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={LABEL_CLASS}>Mobile number</span>
                <AuPhoneInput
                  value={customerPhone}
                  onChange={setCustomerPhone}
                  autoComplete="off"
                  className="mt-1"
                />
              </label>
              <label className="block">
                <span className={LABEL_CLASS}>Email</span>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="off"
                  disabled={submitting}
                  className={INPUT_CLASS}
                />
              </label>
            </div>

            <div className="border-t border-outline-variant/40 pt-4">
              <p className={LABEL_CLASS}>Service address (optional)</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={LABEL_CLASS}>Street address</span>
                  <input
                    type="text"
                    value={street}
                    onChange={(event) => setStreet(event.target.value)}
                    placeholder="e.g. 12 Main Street"
                    disabled={submitting}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>Suburb</span>
                  <input
                    type="text"
                    value={suburb}
                    onChange={(event) => setSuburb(event.target.value)}
                    placeholder="e.g. Surry Hills"
                    disabled={submitting}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>State</span>
                  <input
                    type="text"
                    value={state}
                    onChange={(event) => setState(event.target.value)}
                    placeholder="e.g. NSW"
                    disabled={submitting}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block sm:max-w-[12rem]">
                  <span className={LABEL_CLASS}>Postcode</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={postcode}
                    onChange={(event) =>
                      setPostcode(
                        event.target.value.replace(/\D/g, "").slice(0, 4),
                      )
                    }
                    placeholder="e.g. 2000"
                    disabled={submitting}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
            </div>

            <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container/50 px-3 py-2.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
              Pick an existing customer to pre-fill their details and address, or
              edit everything manually.
            </p>
          </FormSection>

          <FormSection step={2} title="Service">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RequestTypeCard
                icon="format_list_bulleted"
                label="Existing service"
                description="Pick from the services this business offers."
                selected={isExistingService}
                disabled={
                  submitting ||
                  (!servicesLoading && activeServices.length === 0)
                }
                onSelect={() => {
                  setRequestType("existing_service");
                  setError(null);
                }}
              />
              <RequestTypeCard
                icon="request_quote"
                label="Custom job"
                description="Describe the work with a custom title and scope."
                selected={!isExistingService}
                disabled={submitting}
                onSelect={() => {
                  setRequestType("custom_quote");
                  if (!customTitle.trim() && serviceName.trim()) {
                    setCustomTitle(serviceName.trim());
                  }
                  setError(null);
                }}
              />
            </div>

            {isExistingService ? (
              activeServices.length > 0 || servicesLoading ? (
                <ServiceSelectField
                  services={activeServices}
                  selectedService={selectedService}
                  loading={servicesLoading}
                  disabled={submitting}
                  onSelect={(serviceId) => {
                    setSelectedServiceId(serviceId);
                    const next = activeServices.find(
                      (service) => service.id === serviceId,
                    );
                    if (next) setServiceName(next.name);
                    setError(null);
                  }}
                />
              ) : (
                <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container/50 px-3 py-2.5 font-body text-[12px] text-on-surface-variant">
                  No active services found. Add a service in Settings, or switch
                  to a custom job.
                </p>
              )
            ) : (
              <div className="grid gap-3">
                <label className="block">
                  <span className={LABEL_CLASS}>Scope of Work</span>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(event) => setCustomTitle(event.target.value)}
                    placeholder="e.g. Replace kitchen tap and check leak"
                    maxLength={120}
                    disabled={submitting}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="block">
                  <span className={LABEL_CLASS}>
                    What needs doing?{" "}
                    <span className="font-normal normal-case tracking-normal text-outline">
                      (optional)
                    </span>
                  </span>
                  <textarea
                    value={customDescription}
                    onChange={(event) =>
                      setCustomDescription(event.target.value)
                    }
                    rows={4}
                    disabled={submitting}
                    className={`${INPUT_CLASS} resize-y`}
                  />
                </label>
              </div>
            )}
          </FormSection>

          <FormSection step={3} title="Schedule the job">
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="flex items-start gap-2 font-body text-[13px] font-semibold text-on-surface">
                <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[18px] text-primary">
                  info
                </span>
                How to reschedule this job
              </p>
              <ul className="mt-2 space-y-1.5 pl-7 font-body text-[12px] leading-relaxed text-on-surface-variant">
                <li>Pick the day on the strip, then tap hourly slots for time on site.</li>
                <li>Each hourly slot is one hour — select multiple for longer work.</li>
                <li>Estimated time updates the selected window automatically.</li>
              </ul>
            </div>

            <SlotDayPicker
              selectedIso={date}
              mode="single"
              minDate={minDate}
              dayPage={dayPage}
              onDayPageChange={setDayPage}
              disabled={submitting}
              label="Job day"
              dayStripLayout="fit"
              timeZone={timeZone}
              allowPast
              onSelect={(iso) => {
                setDate(iso);
                setError(null);
              }}
            />

            {date ? (
              <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <AdminDaySchedulePicker
                  date={date}
                  kind="job"
                  startTime={startTime || null}
                  endTime={endTime || null}
                  disabled={submitting}
                  hideTimeRangeFields
                  multiHourSlots
                  excludeBookingId={booking.id}
                  timeZone={timeZone}
                  onWindowChange={(start, end) => {
                    setStartTime(start ?? "");
                    setEndTime(end ?? "");
                  }}
                  onStartTimeChange={(nextStart) => {
                    setStartTime(nextStart);
                    setEndTime(defaultCalendarVisitEnd(nextStart));
                  }}
                  onEndTimeChange={(nextEnd) => {
                    setEndTime(nextEnd);
                  }}
                />
              </div>
            ) : null}

            <label className="block">
              <span className={LABEL_CLASS}>Estimated time on site</span>
              <JobEstimateSelect
                value={estimatedMinutes}
                disabled={submitting || !startTime}
                onChange={(minutes) => {
                  setEstimatedMinutes(minutes);
                  if (startTime) {
                    setEndTime(endClockFromEstimate(startTime, minutes));
                  }
                }}
              />
            </label>
          </FormSection>

          <FormSection step={4} title="Notes & instructions">
            <JobInstructionsFields
              description={instructions}
              tasks={instructionTasks}
              disabled={submitting}
              onDescriptionChange={setInstructions}
              onTasksChange={setInstructionTasks}
            />

            <label className="block">
              <span className={LABEL_CLASS}>Note for customer (optional)</span>
              <textarea
                value={ownerNote}
                onChange={(event) => setOwnerNote(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Please ensure access to the meter box."
                disabled={submitting}
                className={`${INPUT_CLASS} resize-y`}
              />
            </label>
          </FormSection>

          <button
            type="button"
            onClick={() => void save()}
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 font-body text-[14px] font-semibold text-on-primary shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60 sm:max-w-xs"
          >
            {submitting ? (
              <SaveSpinner label="Saving…" />
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">
                  save
                </span>
                Save changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
