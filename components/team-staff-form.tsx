"use client";

import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useMemo, useState } from "react";

const STEPS = ["Details", "Role", "Availability"] as const;

const WEEK_DAYS = [
  { id: "monday", label: "Monday" },
  { id: "tuesday", label: "Tuesday" },
  { id: "wednesday", label: "Wednesday" },
  { id: "thursday", label: "Thursday" },
  { id: "friday", label: "Friday" },
  { id: "saturday", label: "Saturday" },
  { id: "sunday", label: "Sunday" },
] as const;

type WeekDayId = (typeof WEEK_DAYS)[number]["id"];

type DayAvailability = {
  day: WeekDayId;
  isOff: boolean;
  serviceAreas: string[];
};

type StaffFormState = {
  fullName: string;
  phone: string;
  email: string;
  staffType: string;
  availability: DayAvailability[];
};

type StaffStatus = "active" | "suspended";

type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  staffType: string;
  availability: DayAvailability[];
  status: StaffStatus;
  createdAt: string | null;
};

type SetupMode = "create" | "edit";

function defaultAvailability(): DayAvailability[] {
  return WEEK_DAYS.map((day) => ({
    day: day.id,
    isOff: false,
    serviceAreas: [],
  }));
}

function emptyForm(): StaffFormState {
  return {
    fullName: "",
    phone: "",
    email: "",
    staffType: "",
    availability: defaultAvailability(),
  };
}

export function TeamStaffForm() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [serviceAreas, setServiceAreas] = useState<string[]>([]);
  const [form, setForm] = useState<StaffFormState>(() => emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const [successMode, setSuccessMode] = useState<SetupMode>("create");
  const [isSaving, setIsSaving] = useState(false);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [staffListError, setStaffListError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>("create");
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [viewTarget, setViewTarget] = useState<StaffMember | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StaffMember | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [search, setSearch] = useState("");

  const canSubmit = useMemo(
    () => staffFormValidationError(form, serviceAreas) === null,
    [form, serviceAreas],
  );

  const filteredStaffMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return staffMembers.filter((member) => {
      const matchesSearch =
        !query ||
        member.fullName.toLowerCase().includes(query) ||
        member.email.toLowerCase().includes(query) ||
        staffTypeLabel(member.staffType).toLowerCase().includes(query);

      return matchesSearch;
    });
  }, [search, staffMembers]);

  function updateField(
    field: "fullName" | "phone" | "email",
    value: string,
  ) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function updateStaffType(staffType: string) {
    setForm((current) => ({ ...current, staffType }));
    setError(null);
  }

  function toggleOffDay(day: WeekDayId) {
    setForm((current) => {
      return {
        ...current,
        availability: current.availability.map((item) =>
          item.day === day
            ? {
                ...item,
                isOff: !item.isOff,
                serviceAreas: item.isOff ? item.serviceAreas : [],
              }
            : item,
        ),
      };
    });
    setError(null);
  }

  function toggleDayServiceArea(day: WeekDayId, area: string) {
    setForm((current) => ({
      ...current,
      availability: current.availability.map((item) => {
        if (item.day !== day) return item;
        const selected = item.serviceAreas.includes(area);
        return {
          ...item,
          isOff: false,
          serviceAreas: selected
            ? item.serviceAreas.filter((value) => value !== area)
            : [...item.serviceAreas, area],
        };
      }),
    }));
    setError(null);
  }

  function resetFormState() {
    setForm(emptyForm());
    setCurrentStep(1);
    setError(null);
    setIsSaving(false);
  }

  function openSetup() {
    resetFormState();
    setSetupMode("create");
    setEditTarget(null);
    setSetupOpen(true);
  }

  function openEditStaff(member: StaffMember) {
    setForm({
      fullName: member.fullName,
      phone: member.phone ?? "",
      email: member.email,
      staffType: member.staffType,
      availability: normalizeAvailability(member.availability, serviceAreas),
    });
    setCurrentStep(1);
    setError(null);
    setSetupMode("edit");
    setEditTarget(member);
    setSetupOpen(true);
  }

  function closeSetup() {
    resetFormState();
    setSetupOpen(false);
    setSetupMode("create");
    setEditTarget(null);
  }

  function addAnotherStaffMember() {
    setSuccessName(null);
    openSetup();
  }

  const loadStaffMembers = useCallback(async () => {
    if (!user) return;

    setIsLoadingStaff(true);
    setStaffListError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/team/staff", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = (await response.json()) as {
        ok?: boolean;
        staff?: StaffMember[];
        serviceAreas?: string[];
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not load staff members.");
      }

      setStaffMembers(data.staff ?? []);
      setServiceAreas(data.serviceAreas ?? []);
    } catch (loadError) {
      setStaffListError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load staff members.",
      );
    } finally {
      setIsLoadingStaff(false);
    }
  }, [user]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadStaffMembers();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadStaffMembers]);

  function detailsAreValid() {
    return (
      form.fullName.trim().length > 0 &&
      form.phone.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    );
  }

  function goToNextStep() {
    if (currentStep === 1 && !detailsAreValid()) {
      setError("Enter a name, mobile number and valid email address.");
      return;
    }

    if (currentStep === 2 && !form.staffType.trim()) {
      setError("Type a staff role, e.g. Plumber or Electrician.");
      return;
    }

    if (currentStep === 3 && !availabilityIsValid(form.availability, serviceAreas)) {
      setError("Select service areas for each working day or mark the day off.");
      return;
    }

    setError(null);
    setCurrentStep((step) => Math.min(STEPS.length, step + 1));
  }

  async function saveStaff() {
    if (!user) {
      setError("Please sign in again before saving staff.");
      return;
    }

    if (!canSubmit) {
      setError(
        staffFormValidationError(form, serviceAreas) ??
          "Could not validate this staff member.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/team/staff", {
        method: setupMode === "edit" ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(setupMode === "edit" && editTarget ? { id: editTarget.id } : {}),
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          staffType: form.staffType.trim(),
          availability: form.availability,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not save this staff member.");
      }

      const savedName = form.fullName.trim();
      const savedMode = setupMode;
      await loadStaffMembers();
      setSetupOpen(false);
      resetFormState();
      setSetupMode("create");
      setEditTarget(null);
      setSuccessMode(savedMode);
      setSuccessName(savedName);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this staff member.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteStaff() {
    if (!user || !deleteTarget || isDeleting) return;

    setIsDeleting(true);
    setStaffListError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/team/staff?id=${encodeURIComponent(deleteTarget.id)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not delete this staff member.");
      }

      setDeleteTarget(null);
      await loadStaffMembers();
    } catch (deleteError) {
      setStaffListError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete this staff member.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function updateStaffStatus(member: StaffMember) {
    if (!user || isUpdatingStatus) return;

    const nextStatus: StaffStatus =
      member.status === "suspended" ? "active" : "suspended";
    setIsUpdatingStatus(true);
    setStaffListError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/team/staff", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: member.id,
          status: nextStatus,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not update staff status.");
      }

      setStaffMembers((current) =>
        current.map((item) =>
          item.id === member.id ? { ...item, status: nextStatus } : item,
        ),
      );
      setViewTarget((current) =>
        current?.id === member.id ? { ...current, status: nextStatus } : current,
      );
      setStatusTarget(null);
      void loadStaffMembers();
    } catch (statusError) {
      setStaffListError(
        statusError instanceof Error
          ? statusError.message
          : "Could not update staff status.",
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  return (
    <>
      <StaffMembersList
        members={filteredStaffMembers}
        totalCount={staffMembers.length}
        search={search}
        isLoading={isLoadingStaff}
        error={staffListError}
        onSearchChange={setSearch}
        onRefresh={() => void loadStaffMembers()}
        onSetup={openSetup}
        onView={setViewTarget}
        onEdit={openEditStaff}
        onDelete={setDeleteTarget}
        onToggleStatus={setStatusTarget}
      />

      {setupOpen && (
        <StaffSetupModal
          currentStep={currentStep}
          mode={setupMode}
          onClose={closeSetup}
          onBack={() => {
            setError(null);
            setCurrentStep((step) => Math.max(1, step - 1));
          }}
          onContinue={goToNextStep}
          onSave={() => void saveStaff()}
          isSaving={isSaving}
          error={error}
        >
          <form
            id="team-staff-setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (currentStep < STEPS.length) {
                goToNextStep();
                return;
              }
              void saveStaff();
            }}
            className="mx-auto flex max-w-3xl flex-col gap-5"
          >
            <StaffSetupStepContent
              currentStep={currentStep}
              form={form}
              serviceAreas={serviceAreas}
              onUpdateField={updateField}
              onStaffTypeChange={updateStaffType}
              onToggleOffDay={toggleOffDay}
              onToggleServiceArea={toggleDayServiceArea}
            />
          </form>
        </StaffSetupModal>
      )}

      <StaffDetailDrawer
        member={viewTarget}
        onClose={() => setViewTarget(null)}
        onEdit={(member) => {
          setViewTarget(null);
          openEditStaff(member);
        }}
        onToggleStatus={setStatusTarget}
      />

      <StaffStatusConfirmModal
        member={statusTarget}
        isLoading={isUpdatingStatus}
        onCancel={() => {
          if (!isUpdatingStatus) setStatusTarget(null);
        }}
        onConfirm={() => {
          if (statusTarget) void updateStaffStatus(statusTarget);
        }}
      />

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="Delete staff member?"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.fullName}"? This removes the staff user from this business.`
            : ""
        }
        confirmLabel="Yes, delete"
        cancelLabel="No, cancel"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={() => void deleteStaff()}
      />

      {successName && (
        <SuccessModal
          name={successName}
          mode={successMode}
          onAddAnother={addAnotherStaffMember}
          onClose={() => setSuccessName(null)}
        />
      )}
    </>
  );
}

function StaffSetupStepContent({
  currentStep,
  form,
  serviceAreas,
  onUpdateField,
  onStaffTypeChange,
  onToggleOffDay,
  onToggleServiceArea,
}: {
  currentStep: number;
  form: StaffFormState;
  serviceAreas: string[];
  onUpdateField: (field: "fullName" | "phone" | "email", value: string) => void;
  onStaffTypeChange: (staffType: string) => void;
  onToggleOffDay: (day: WeekDayId) => void;
  onToggleServiceArea: (day: WeekDayId, area: string) => void;
}) {
  if (currentStep === 1) {
    return (
      <>
        <StaffSetupHero
          eyebrow="Step 1 · Staff profile"
          title="Who is joining your team?"
          description="Capture the staff member's contact details so bookings and job updates can be routed correctly."
          icon="badge"
        />

        <StaffWizardSection
          icon="person"
          title="Personal information"
          subtitle="These details are saved to the users table."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField
              label="Full Name"
              placeholder="e.g. Jordan Smith"
              value={form.fullName}
              onChange={(value) => onUpdateField("fullName", value)}
              required
            />
            <TextField
              label="Mobile Number"
              placeholder="0400 000 000"
              type="tel"
              value={form.phone}
              onChange={(value) => onUpdateField("phone", value)}
              required
            />
            <div className="md:col-span-2">
              <TextField
                label="Email Address"
                placeholder="jordan@business.com"
                type="email"
                value={form.email}
                onChange={(value) => onUpdateField("email", value)}
                required
              />
            </div>
          </div>
        </StaffWizardSection>
      </>
    );
  }

  if (currentStep === 2) {
    return (
      <>
        <StaffSetupHero
          eyebrow="Step 2 · Staff role"
          title="What role does this staff member have?"
          description="Type the role used when assigning bookings and jobs."
          icon="construction"
        />

        <StaffWizardSection
          icon="home_repair_service"
          title="Role"
          subtitle="Enter a role such as Plumber, Electrician, HVAC Technician or Supervisor."
        >
          <TextField
            label="Role"
            placeholder="e.g. Plumber, Electrician"
            value={form.staffType}
            onChange={onStaffTypeChange}
            required
          />
        </StaffWizardSection>
      </>
    );
  }

  return (
    <>
      <StaffSetupHero
        eyebrow="Step 3 · Availability"
        title="When can they take jobs?"
        description="Choose all seven days, mark off days, and assign service areas to each working day."
        icon="event_available"
      />

      <StaffWizardSection
        icon="calendar_month"
        title="Typical availability"
        subtitle="Working days need at least one service area. Off days do not."
      >
        <div className="grid grid-cols-1 gap-3" aria-required="true">
          {form.availability.map((day) => (
            <DayAvailabilityCard
              key={day.day}
              availability={day}
              serviceAreas={serviceAreas}
              onToggleOff={() => onToggleOffDay(day.day)}
              onToggleArea={(area) => onToggleServiceArea(day.day, area)}
            />
          ))}
        </div>
      </StaffWizardSection>

      <StaffReviewPanel form={form} />
    </>
  );
}

function StaffSetupHero({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-4 py-5 text-on-primary">
      <div
        className="pointer-events-none absolute -right-4 top-0 opacity-[0.1]"
        aria-hidden
      >
        <span className="material-symbols-outlined text-[6rem]">{icon}</span>
      </div>
      <p className="relative font-body text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
        {eyebrow}
      </p>
      <h3 className="relative mt-1 font-display text-[1.35rem] font-semibold leading-tight text-white">
        {title}
      </h3>
      <p className="relative mt-2 max-w-md font-body text-[13px] text-white/85">
        {description}
      </p>
    </div>
  );
}

function StaffWizardSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest shadow-sm">
      <div className="flex items-start gap-3 border-b border-outline-variant/50 bg-gradient-to-r from-primary-fixed/50 via-surface-container-low to-surface-container-lowest px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </span>
        <div className="min-w-0">
          <h4 className="font-display text-[15px] font-semibold text-on-surface">
            {title}
          </h4>
          {subtitle ? (
            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function StaffSetupModal({
  currentStep,
  mode,
  children,
  error,
  isSaving,
  onClose,
  onBack,
  onContinue,
  onSave,
}: {
  currentStep: number;
  mode: SetupMode;
  children: React.ReactNode;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onBack: () => void;
  onContinue: () => void;
  onSave: () => void;
}) {
  const progressPercent = Math.round((currentStep / STEPS.length) * 100);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close staff setup"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-setup-title"
        className="relative z-10 grid h-[94dvh] max-h-[94dvh] w-full max-w-4xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:h-[min(92dvh,calc(100dvh-2rem))] sm:max-h-[min(92dvh,calc(100dvh-2rem))] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
              Step {currentStep} of {STEPS.length}
            </p>
            <h2
              id="staff-setup-title"
              className="font-display text-headline-sm font-semibold text-on-surface"
            >
              {mode === "edit" ? "Edit staff member" : "Setup staff member"}
            </h2>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              {mode === "edit"
                ? "Update contact details, role and availability for this staff user."
                : "Add contact details, role and availability for this staff user."}
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
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
          {error && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                error
              </span>
              <span>{error}</span>
            </div>
          )}
          {children}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-variant bg-background px-5 py-4 shadow-[0_-8px_24px_rgba(0,42,150,0.08)] sm:px-6">
          <button
            type="button"
            onClick={currentStep === 1 ? onClose : onBack}
            className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            {currentStep === 1 ? "Cancel" : "Back"}
          </button>

          {currentStep < STEPS.length ? (
            <button
              type="button"
              onClick={onContinue}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary"
            >
              Continue
              <span className="material-symbols-outlined text-[18px]">
                arrow_forward
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
            >
              {isSaving ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                  Saving...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">
                    save
                  </span>
                  {mode === "edit" ? "Save changes" : "Save staff"}
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "email" | "tel";
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-body text-label-bold text-label-bold text-on-surface-variant">
        {label}
        {required && <RequiredMark />}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-12 rounded-lg border border-outline-variant bg-surface px-4 font-body text-body-md text-on-surface transition-all placeholder:text-outline focus:border-primary focus:outline-none focus:ring-0"
      />
    </label>
  );
}

function RequiredMark() {
  return (
    <span className="ml-1 text-error" aria-label="required">
      *
    </span>
  );
}

function DayAvailabilityCard({
  availability,
  serviceAreas,
  onToggleOff,
  onToggleArea,
}: {
  availability: DayAvailability;
  serviceAreas: string[];
  onToggleOff: () => void;
  onToggleArea: (area: string) => void;
}) {
  const dayLabel = dayName(availability.day);

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
        availability.isOff
          ? "border-outline-variant bg-surface-container-lowest opacity-80"
          : "border-primary/30 bg-primary-fixed/20 shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              availability.isOff
                ? "bg-surface-container-high text-outline"
                : "bg-primary text-on-primary"
            }`}
          >
            <span className="material-symbols-outlined text-[24px]">
              {availability.isOff ? "event_busy" : "event_available"}
            </span>
          </span>
          <div>
            <p className="font-body text-[15px] font-semibold text-on-surface">
              {dayLabel}
            </p>
            <p className="mt-1 font-body text-[12px] leading-relaxed text-on-surface-variant">
              {availability.isOff
                ? "Off day"
                : `${availability.serviceAreas.length} service area${
                    availability.serviceAreas.length === 1 ? "" : "s"
                  } selected`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleOff}
          className={`rounded-lg px-3 py-2 font-body text-[12px] font-semibold transition-colors ${
            availability.isOff
              ? "bg-primary text-on-primary hover:bg-primary/90"
              : "border border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container"
          }`}
        >
          {availability.isOff ? "Mark working" : "Mark off"}
        </button>
      </div>

      {!availability.isOff && (
        <div className="mt-4">
          {serviceAreas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-outline-variant bg-surface-container-lowest px-3 py-3 font-body text-[12px] text-on-surface-variant">
              No business service areas configured yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {serviceAreas.map((area) => {
                const selected = availability.serviceAreas.includes(area);
                return (
                  <button
                    key={area}
                    type="button"
                    onClick={() => onToggleArea(area)}
                    className={`rounded-full border px-3 py-1.5 font-body text-[12px] font-semibold transition-all ${
                      selected
                        ? "border-primary bg-primary text-on-primary"
                        : "border-outline-variant bg-surface-container-lowest text-on-surface hover:border-primary/40"
                    }`}
                  >
                    {area}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StaffReviewPanel({ form }: { form: StaffFormState }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="flex flex-col gap-4 border-b border-outline-variant/60 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:gap-5">
        <span className="mx-auto flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary sm:mx-0">
          <span className="material-symbols-outlined material-symbols-filled text-[32px]">
            person
          </span>
        </span>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h4 className="font-display text-headline-sm font-semibold text-on-surface">
            {form.fullName.trim() || "New staff member"}
          </h4>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            {form.email.trim() || "No email yet"}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-fixed/50 px-3 py-1 font-body text-[12px] font-semibold text-on-primary-fixed-variant">
              <span className="material-symbols-outlined text-[16px] text-primary">
                call
              </span>
              {form.phone.trim() || "No mobile"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-fixed px-3 py-1 font-body text-[12px] font-semibold text-on-primary-fixed-variant">
              <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
                check_circle
              </span>
              Staff
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
        <ReviewMetaRow
          icon={staffTypeIcon(form.staffType)}
          label="Role"
          value={staffTypeLabel(form.staffType)}
        />
        <ReviewMetaRow
          icon="event_available"
          label="Availability"
          value={`${workingDayCount(form.availability)} working day${
            workingDayCount(form.availability) === 1 ? "" : "s"
          }`}
        />
      </div>
    </section>
  );
}

function ReviewMetaRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface-container-lowest/80 px-3 py-2.5">
      <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label}
        </p>
        <p className="mt-0.5 font-body text-[14px] font-semibold text-on-surface">
          {value}
        </p>
      </div>
    </div>
  );
}

function StaffMembersList({
  members,
  totalCount,
  search,
  isLoading,
  error,
  onSearchChange,
  onRefresh,
  onSetup,
  onView,
  onEdit,
  onDelete,
  onToggleStatus,
}: {
  members: StaffMember[];
  totalCount: number;
  search: string;
  isLoading: boolean;
  error: string | null;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
  onSetup: () => void;
  onView: (member: StaffMember) => void;
  onEdit: (member: StaffMember) => void;
  onDelete: (member: StaffMember) => void;
  onToggleStatus: (member: StaffMember) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            Staff members
          </h3>
          <p className="font-body text-body-md text-on-surface-variant">
            {totalCount} {totalCount === 1 ? "person" : "people"} saved as staff.
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="relative flex h-10 w-full items-center sm:w-56">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 text-[18px] text-outline">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search staff..."
              className="h-full w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-10 pr-3 font-body text-[13px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex h-10 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                isLoading ? "animate-spin" : ""
              }`}
            >
              refresh
            </span>
            Refresh
          </button>
          <button
            type="button"
            onClick={onSetup}
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Setup staff
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-low">
          <div className="flex items-center gap-3 font-body text-body-md text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-primary">
              progress_activity
            </span>
            Loading staff members...
          </div>
        </div>
      ) : members.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-14 text-center">
          <span className="material-symbols-outlined mb-3 text-[40px] text-outline">
            groups
          </span>
          <h4 className="font-body text-body-lg font-bold text-on-surface">
            {totalCount === 0 ? "No staff members yet" : "No staff match your filters"}
          </h4>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {totalCount === 0
              ? "Setup your first staff member to start assigning jobs."
              : "Try a different staff name, email or role."}
          </p>
          {totalCount === 0 ? (
            <button
              type="button"
              onClick={onSetup}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Setup staff
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,18.5rem)] sm:justify-items-start">
          {members.map((member) => (
            <StaffMemberCard
              key={member.id}
              member={member}
              onView={() => onView(member)}
              onEdit={() => onEdit(member)}
              onDelete={() => onDelete(member)}
              onToggleStatus={() => onToggleStatus(member)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StaffMemberCard({
  member,
  onView,
  onEdit,
  onDelete,
  onToggleStatus,
}: {
  member: StaffMember;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const roleLabel = staffTypeLabel(member.staffType);
  const serviceAreaLabels = serviceAreasForStaff(member);
  const isSuspended = member.status === "suspended";

  return (
    <article className="mx-auto flex w-full max-w-[18.5rem] flex-col overflow-hidden rounded-2xl shadow-[0_6px_20px_rgba(0,42,150,0.08)] ring-1 ring-outline-variant/40 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,74,198,0.14)] hover:ring-primary/25">
      <div className="relative h-[10.5rem] w-full overflow-hidden bg-gradient-to-br from-[#00174b] via-primary-container to-primary">
        <div
          className="pointer-events-none absolute -right-4 -top-2 opacity-[0.12]"
          aria-hidden
        >
          <span className="material-symbols-outlined text-[7rem]">groups</span>
        </div>
        <div
          className="pointer-events-none absolute -left-6 bottom-0 h-28 w-28 rounded-full bg-inverse-primary/25 blur-2xl"
          aria-hidden
        />

        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-1 font-body text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm ${
            isSuspended
              ? "bg-error/80 text-on-error"
              : "bg-white/15 text-white/95"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {!isSuspended ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
            ) : null}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          {isSuspended ? "Suspended" : "Active"}
        </span>

        <div className="absolute right-2 top-2 z-10 flex gap-0.5">
          {(
            [
              [
                isSuspended ? "person" : "person_off",
                isSuspended ? "Reactivate staff" : "Suspend staff",
                onToggleStatus,
              ],
              ["edit", "Edit staff", onEdit],
              ["delete", "Delete staff", onDelete],
            ] as const
          ).map(([icon, label, action]) => (
            <button
              key={icon}
              type="button"
              title={label}
              onClick={action}
              className={`flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur-md transition-colors ${
                icon === "delete"
                  ? "bg-white/10 text-white/90 hover:bg-error hover:text-on-error"
                  : "bg-white/10 text-white hover:bg-white hover:text-primary-container"
              }`}
            >
              <span className="material-symbols-outlined text-[17px]">
                {icon}
              </span>
            </button>
          ))}
        </div>

        <div className="absolute inset-x-0 top-8 flex justify-center">
          {/* Generated SVG avatars are intentionally remote and lightweight. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrlFor(member)}
            alt={`${member.fullName} profile avatar`}
            className="h-20 w-20 rounded-full border-4 border-white/80 bg-white object-cover shadow-lg"
          />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,23,75,0.05)_0%,transparent_45%,rgba(0,23,75,0.8)_100%)]"
        />

        <div className="absolute inset-x-0 bottom-0 px-3.5 pb-3.5 pt-8 text-center">
          <h3 className="line-clamp-1 font-display text-[1.125rem] font-semibold leading-snug text-white">
            {member.fullName}
          </h3>
          <p className="mt-0.5 line-clamp-1 font-body text-[11px] text-white/85">
            {roleLabel}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 bg-gradient-to-b from-primary-fixed/40 via-surface-container-low to-surface-container-low px-3.5 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5 font-body text-[11px] font-semibold text-on-surface-variant">
          <span className="inline-flex items-center gap-0.5 text-on-surface">
            <span className="material-symbols-outlined text-[13px] text-primary">
              call
            </span>
            {member.phone || "No phone"}
          </span>
          <span aria-hidden className="text-outline-variant">
            ·
          </span>
          <span className="inline-flex items-center gap-0.5 text-on-surface">
            <span className="material-symbols-outlined text-[13px] text-primary">
              event_available
            </span>
            {workingDayCount(member.availability)}
          </span>
        </div>

        <div className="min-h-[5.25rem] rounded-lg border border-primary-fixed/50 bg-surface-container-lowest/75 px-3 py-2.5 backdrop-blur-sm">
          <p className="mb-2 line-clamp-1 font-body text-[11px] font-semibold text-on-surface-variant">
            {member.email || "No email"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {serviceAreaLabels.length > 0 ? (
              serviceAreaLabels.slice(0, 3).map((area) => (
                <span
                  key={area}
                  className="rounded-full bg-primary/10 px-2 py-0.5 font-body text-[10px] font-bold text-primary"
                >
                  {area}
                </span>
              ))
            ) : (
              <span className="font-body text-[11px] italic text-outline">
                No service areas
              </span>
            )}
            {serviceAreaLabels.length > 3 ? (
              <span className="rounded-full bg-primary-fixed px-2 py-0.5 font-body text-[10px] font-bold text-on-primary-fixed-variant">
                +{serviceAreaLabels.length - 3}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-primary-fixed/50 pt-2">
          <span className="font-body text-[11px] font-semibold text-on-surface-variant">
            Added {formatDate(member.createdAt)}
          </span>
          <span className="line-clamp-1 max-w-28 text-right font-body text-[11px] font-bold text-primary">
            {workingDayCount(member.availability)} working
          </span>
        </div>

        <button
          type="button"
          onClick={onView}
          className="inline-flex w-full items-center justify-center gap-0.5 py-1 font-body text-[13px] font-bold text-primary transition-colors hover:text-primary/80"
        >
          View details
          <span className="material-symbols-outlined text-[16px]">
            arrow_forward
          </span>
        </button>
      </div>
    </article>
  );
}

function StaffDetailDrawer({
  member,
  onClose,
  onEdit,
  onToggleStatus,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onEdit: (member: StaffMember) => void;
  onToggleStatus: (member: StaffMember) => void;
}) {
  useEffect(() => {
    if (!member) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [member, onClose]);

  if (!member) return null;
  const isSuspended = member.status === "suspended";

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close staff details"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/45 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-detail-title"
        className="absolute inset-y-0 right-0 flex w-[calc(100%-1.25rem)] max-w-md flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-outline-variant bg-background shadow-2xl sm:w-full sm:rounded-none sm:border-y-0 sm:border-r-0 sm:border-l"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {/* Generated SVG avatars are intentionally remote and lightweight. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrlFor(member)}
              alt=""
              className="h-14 w-14 shrink-0 rounded-2xl border border-outline-variant bg-white object-cover"
            />
            <div className="min-w-0">
              <h2
                id="staff-detail-title"
                className="truncate font-display text-headline-sm font-semibold text-on-surface"
              >
                {member.fullName || "Staff details"}
              </h2>
              <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
                Staff member
              </p>
              <span
                className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold uppercase ${
                  isSuspended
                    ? "bg-error-container text-on-error-container"
                    : "border border-primary/20 bg-primary-fixed text-on-primary-fixed-variant"
                }`}
              >
                {isSuspended ? "Suspended" : "Active"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <DetailSection title="Contact">
            <DetailRow label="Name" value={member.fullName || "—"} />
            <DetailRow label="Email" value={member.email || "—"} />
            <DetailRow label="Mobile" value={member.phone || "—"} />
          </DetailSection>

          <DetailSection title="Work profile">
            <DetailRow
              label="Role"
              value={staffTypeLabel(member.staffType)}
            />
            <DetailRow
              label="Working days"
              value={`${workingDayCount(member.availability)} of 7`}
            />
          </DetailSection>

          <DetailSection title="Weekly service areas">
            {member.availability.map((day) => (
              <DetailRow
                key={day.day}
                label={dayName(day.day)}
                value={
                  day.isOff
                    ? "Off day"
                    : day.serviceAreas.length > 0
                      ? day.serviceAreas.join(", ")
                      : "No service areas"
                }
              />
            ))}
          </DetailSection>

          <DetailSection title="Record">
            <DetailRow
              label="Status"
              value={isSuspended ? "Suspended" : "Active"}
            />
            <DetailRow label="Created" value={formatDate(member.createdAt)} />
          </DetailSection>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-outline-variant bg-surface-container-low px-5 py-4">
          <button
            type="button"
            onClick={() => onToggleStatus(member)}
            className={`flex h-10 items-center gap-2 rounded-lg px-4 font-body text-[13px] font-semibold transition-colors ${
              isSuspended
                ? "bg-primary text-on-primary hover:bg-primary/90"
                : "border border-[#fed7aa] bg-[#fff8eb] text-[#b45309] hover:bg-[#ffedd5] hover:text-[#9a3412]"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              {isSuspended ? "person" : "person_off"}
            </span>
            {isSuspended ? "Reactivate" : "Suspend"}
          </button>
          <button
            type="button"
            onClick={() => onEdit(member)}
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
            Edit staff
          </button>
        </footer>
      </aside>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </h3>
      <dl className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant bg-surface-container-lowest">
        {children}
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="shrink-0 font-body text-[12px] font-semibold text-on-surface-variant">
        {label}
      </dt>
      <dd className="font-body text-[13px] text-on-surface sm:max-w-[58%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}

function staffTypeLabel(value: string) {
  return value.trim() || "No role";
}

function staffTypeIcon(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("plumb")) return "plumbing";
  if (normalized.includes("electric")) return "bolt";
  return "badge";
}

function dayName(day: WeekDayId) {
  return WEEK_DAYS.find((item) => item.id === day)?.label ?? day;
}

function normalizeAvailability(
  availability: unknown,
  serviceAreas: string[],
): DayAvailability[] {
  if (Array.isArray(availability)) {
    const byDay = new Map<string, unknown>();
    for (const item of availability) {
      if (item && typeof item === "object") {
        const rawDay = (item as Record<string, unknown>).day;
        if (typeof rawDay === "string") byDay.set(rawDay, item);
      }
    }

    return WEEK_DAYS.map((day) => {
      const raw = byDay.get(day.id);
      if (!raw || typeof raw !== "object") {
        return {
          day: day.id,
          isOff: false,
          serviceAreas: [],
        };
      }

      const record = raw as Record<string, unknown>;
      return {
        day: day.id,
        isOff: record.isOff === true,
        serviceAreas: Array.isArray(record.serviceAreas)
          ? record.serviceAreas.filter(
              (area): area is string =>
                typeof area === "string" &&
                (serviceAreas.length === 0 || serviceAreas.includes(area)),
            )
          : [],
      };
    });
  }

  return defaultAvailability();
}

function staffFormValidationError(
  form: StaffFormState,
  serviceAreas: string[],
) {
  if (
    !form.fullName.trim() ||
    !form.phone.trim() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
  ) {
    return "Enter a name, mobile number and valid email address.";
  }

  if (!form.staffType.trim()) {
    return "Type a staff role, e.g. Plumber or Electrician.";
  }

  if (!availabilityIsValid(form.availability, serviceAreas)) {
    return "Select service areas for each working day or mark the day off.";
  }

  return null;
}

function availabilityIsValid(
  availability: DayAvailability[],
  serviceAreas: string[],
) {
  const workingDays = availability.filter((day) => !day.isOff);
  if (workingDays.length === 0) return false;
  if (serviceAreas.length === 0) return true;
  return workingDays.every((day) => day.serviceAreas.length > 0);
}

function workingDayCount(availability: DayAvailability[]) {
  return availability.filter((day) => !day.isOff).length;
}

function serviceAreasForStaff(member: StaffMember) {
  return Array.from(
    new Set(
      member.availability.flatMap((day) =>
        day.isOff ? [] : day.serviceAreas,
      ),
    ),
  );
}

function StaffStatusConfirmModal({
  member,
  isLoading,
  onCancel,
  onConfirm,
}: {
  member: StaffMember | null;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isSuspended = member?.status === "suspended";
  const actionLabel = isSuspended ? "reactivate" : "suspend";

  useEffect(() => {
    if (!member) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isLoading) onCancel();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [member, isLoading, onCancel]);

  if (!member) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        disabled={isLoading}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="staff-status-confirm-title"
        aria-describedby="staff-status-confirm-desc"
        className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl"
      >
        <div className="px-6 pt-6 text-center">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
              isSuspended
                ? "bg-primary-fixed text-primary"
                : "bg-[#fff8eb] text-[#b45309]"
            }`}
          >
            <span className="material-symbols-outlined text-[28px]">
              {isSuspended ? "person" : "person_off"}
            </span>
          </div>
          <h2
            id="staff-status-confirm-title"
            className="font-display text-headline-sm font-semibold text-on-surface"
          >
            {isSuspended ? "Reactivate staff member?" : "Suspend staff member?"}
          </h2>
          <p
            id="staff-status-confirm-desc"
            className="mt-2 font-body text-body-md text-on-surface-variant"
          >
            Are you sure you want to {actionLabel}{" "}
            <span className="font-semibold text-on-surface">{member.fullName}</span>
            ?
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-outline-variant bg-surface-container-low px-6 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="flex h-11 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest px-5 font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
          >
            No, cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex h-11 items-center justify-center gap-2 rounded-lg px-5 font-body text-[14px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
              isSuspended
                ? "bg-primary text-on-primary hover:bg-primary/90"
                : "bg-[#b45309] text-white hover:bg-[#9a3412]"
            }`}
          >
            {isLoading ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Updating...
              </>
            ) : isSuspended ? (
              "Yes, reactivate"
            ) : (
              "Yes, suspend"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function avatarUrlFor(member: StaffMember) {
  const seed = encodeURIComponent(member.id || member.email || member.fullName);
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function SuccessModal({
  name,
  mode,
  onAddAnother,
  onClose,
}: {
  name: string;
  mode: SetupMode;
  onAddAnother: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close success modal"
        onClick={onClose}
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-2xl bg-surface p-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-fixed">
          <span className="material-symbols-outlined material-symbols-filled text-[40px] text-primary">
            check_circle
          </span>
        </div>
        <h2 className="mb-2 font-display text-display-md text-display-md text-on-surface">
          {mode === "edit" ? "Staff Updated" : "Staff Added"}
        </h2>
        <p className="mb-8 font-body text-body-lg text-on-surface-variant">
          You have successfully {mode === "edit" ? "updated" : "added"}{" "}
          <span className="font-bold text-on-surface">{name}</span>
          {mode === "edit" ? "." : " to your team."}
        </p>
        {mode === "create" ? (
          <button
            type="button"
            onClick={onAddAnother}
            className="w-full rounded-xl bg-primary py-4 font-body text-body-lg font-bold text-on-primary transition-all hover:bg-primary/90"
          >
            Add Another Member
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className={`${mode === "create" ? "mt-4" : ""} w-full rounded-xl py-3 font-body font-bold text-primary transition-all hover:bg-surface-container-low`}
        >
          Back to Team
        </button>
      </div>
    </div>
  );
}
