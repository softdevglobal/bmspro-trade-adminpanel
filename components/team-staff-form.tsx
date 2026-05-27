"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useCallback, useEffect, useMemo, useState } from "react";

const STEPS = ["Details", "Skills", "Availability"] as const;

const SKILLS = [
  { label: "Electrical", icon: "bolt" },
  { label: "Plumbing", icon: "plumbing" },
  { label: "Carpentry", icon: "carpenter" },
  { label: "HVAC", icon: "ac_unit" },
  { label: "General Maintenance", icon: "home_repair_service" },
] as const;

const AVAILABILITY = ["Weekdays", "Saturdays", "Sundays"] as const;

type StaffFormState = {
  fullName: string;
  phone: string;
  email: string;
  skills: string[];
  availability: string[];
};

type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  skills: string[];
  availability: string[];
  status: string;
  createdAt: string | null;
};

const EMPTY_FORM: StaffFormState = {
  fullName: "",
  phone: "",
  email: "",
  skills: [],
  availability: ["Weekdays"],
};

export function TeamStaffForm() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState<StaffFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [staffListError, setStaffListError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () =>
      form.fullName.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
      form.availability.length > 0,
    [form],
  );

  function updateField(field: keyof StaffFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function toggleSkill(skill: string) {
    setForm((current) => {
      const selected = current.skills.includes(skill);
      return {
        ...current,
        skills: selected
          ? current.skills.filter((item) => item !== skill)
          : [...current.skills, skill],
      };
    });
  }

  function toggleAvailability(day: string) {
    setForm((current) => {
      const selected = current.availability.includes(day);
      return {
        ...current,
        availability: selected
          ? current.availability.filter((item) => item !== day)
          : [...current.availability, day],
      };
    });
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setCurrentStep(1);
    setError(null);
    setSuccessName(null);
    setIsSaving(false);
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
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not load staff members.");
      }

      setStaffMembers(data.staff ?? []);
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

  async function saveStaff() {
    if (!user) {
      setError("Please sign in again before saving staff.");
      return;
    }

    if (!canSubmit) {
      setError("Enter a name, valid email and at least one availability option.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/team/staff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          skills: form.skills,
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

      await loadStaffMembers();
      setSuccessName(form.fullName.trim());
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

  return (
    <>
      <div className="grid grid-cols-12 gap-gutter">
        <section className="col-span-12 space-y-gutter lg:col-span-8">
          <Stepper currentStep={currentStep} />

          <div className="min-h-[420px] rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding shadow-sm">
            {currentStep === 1 && (
              <section>
                <SectionHeading icon="person" title="Personal Information" />
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <TextField
                    label="Full Name"
                    placeholder="e.g. Jordan Smith"
                    value={form.fullName}
                    onChange={(value) => updateField("fullName", value)}
                  />
                  <TextField
                    label="Mobile Number"
                    placeholder="0400 000 000"
                    type="tel"
                    value={form.phone}
                    onChange={(value) => updateField("phone", value)}
                  />
                  <div className="md:col-span-2">
                    <TextField
                      label="Email Address"
                      placeholder="jordan@business.com"
                      type="email"
                      value={form.email}
                      onChange={(value) => updateField("email", value)}
                    />
                  </div>
                </div>
              </section>
            )}

            {currentStep === 2 && (
              <section>
                <SectionHeading
                  icon="construction"
                  title="Work Skills"
                  description="Select the areas this staff member is qualified for."
                />
                <div className="flex flex-wrap gap-3">
                  {SKILLS.map((skill) => {
                    const selected = form.skills.includes(skill.label);
                    return (
                      <button
                        key={skill.label}
                        type="button"
                        onClick={() => toggleSkill(skill.label)}
                        className={`flex items-center gap-2 rounded-full border px-4 py-2 font-body text-label-bold text-label-bold transition-all ${
                          selected
                            ? "border-primary bg-primary text-on-primary shadow-sm"
                            : "border-outline-variant bg-surface text-on-surface hover:border-primary hover:text-primary"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {skill.icon}
                        </span>
                        {skill.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {currentStep === 3 && (
              <section>
                <SectionHeading
                  icon="calendar_month"
                  title="Typical Availability"
                  description="Which days can they take on jobs?"
                />
                <div className="space-y-3">
                  {AVAILABILITY.map((day) => (
                    <AvailabilityRow
                      key={day}
                      label={day}
                      checked={form.availability.includes(day)}
                      onToggle={() => toggleAvailability(day)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-error-container bg-error-container/40 px-4 py-3 font-body text-body-md text-on-error-container">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
              className={`rounded-lg px-6 py-3 font-body text-label-bold text-label-bold text-on-surface-variant transition-all hover:bg-surface-container-high ${
                currentStep === 1 ? "pointer-events-none opacity-0" : ""
              }`}
            >
              Back
            </button>
            {currentStep < STEPS.length ? (
              <button
                type="button"
                onClick={() =>
                  setCurrentStep((step) => Math.min(STEPS.length, step + 1))
                }
                className="rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-label-bold text-on-primary transition-all hover:bg-primary/90 active:scale-95"
              >
                {currentStep === 1 ? "Next: Skills" : "Next: Availability"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void saveStaff()}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-label-bold text-on-primary transition-all hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving && (
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                )}
                {isSaving ? "Saving..." : "Save Staff"}
              </button>
            )}
          </div>
        </section>

        <aside className="col-span-12 lg:col-span-4">
          <StaffPreview form={form} />
        </aside>
      </div>

      <StaffMembersList
        members={staffMembers}
        isLoading={isLoadingStaff}
        error={staffListError}
        onRefresh={() => void loadStaffMembers()}
      />

      {successName && (
        <SuccessModal
          name={successName}
          onAddAnother={resetForm}
          onClose={() => setSuccessName(null)}
        />
      )}
    </>
  );
}

function Stepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-between px-1 sm:px-4">
      {STEPS.map((step, index) => {
        const number = index + 1;
        const completed = number < currentStep;
        const active = number === currentStep;
        return (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            <div
              className={`flex items-center gap-2 sm:gap-3 ${
                active || completed ? "" : "opacity-50"
              }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full font-body text-[14px] font-bold sm:h-10 sm:w-10 ${
                  completed
                    ? "bg-primary-container text-on-primary"
                    : active
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-highest text-on-surface-variant"
                }`}
              >
                {completed ? (
                  <span className="material-symbols-outlined text-[20px]">
                    check
                  </span>
                ) : (
                  number
                )}
              </div>
              <span className="hidden font-body text-label-bold text-label-bold text-primary sm:inline">
                {step}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div className="mx-3 h-[2px] flex-1 bg-outline-variant sm:mx-4" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-6">
      <h3 className="flex items-center gap-2 font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
        <span className="material-symbols-outlined text-primary">{icon}</span>
        {title}
      </h3>
      {description && (
        <p className="mt-2 font-body text-body-md text-on-surface-variant">
          {description}
        </p>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "email" | "tel";
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-body text-label-bold text-label-bold text-on-surface-variant">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-12 rounded-lg border border-outline-variant bg-surface px-4 font-body text-body-md text-on-surface transition-all placeholder:text-outline focus:border-primary focus:outline-none focus:ring-0"
      />
    </label>
  );
}

function AvailabilityRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-outline-variant/30 bg-surface p-4">
      <span className="font-body text-body-md font-bold text-on-surface">
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="peer sr-only"
      />
      <span className="relative h-6 w-11 rounded-full bg-outline-variant transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-outline-variant after:bg-white after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full" />
    </label>
  );
}

function StaffMembersList({
  members,
  isLoading,
  error,
  onRefresh,
}: {
  members: StaffMember[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  return (
    <section className="mt-gutter rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding shadow-sm">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
              Staff Members
            </h3>
            <span className="rounded-full bg-primary/10 px-3 py-1 font-body text-[12px] font-bold text-primary">
              {members.length}
            </span>
          </div>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            People already saved in the users table as staff.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="flex w-fit items-center gap-2 rounded-lg border border-outline-variant bg-surface-container px-4 py-2 font-body text-label-bold text-label-bold text-on-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-60"
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
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-error-container bg-error-container/40 px-4 py-3 font-body text-body-md text-on-error-container">
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
        <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/60 bg-surface-container-low p-6 text-center">
          <span className="material-symbols-outlined mb-3 text-[40px] text-outline">
            groups
          </span>
          <h4 className="font-body text-body-lg font-bold text-on-surface">
            No staff members yet
          </h4>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Staff you save from the form above will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => (
            <StaffMemberCard key={member.id} member={member} />
          ))}
        </div>
      )}
    </section>
  );
}

function StaffMemberCard({ member }: { member: StaffMember }) {
  return (
    <article className="rounded-xl border border-outline-variant bg-surface p-5 transition-all hover:border-primary/40 hover:shadow-md">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary-fixed-dim font-body text-[15px] font-bold text-on-primary-fixed">
            {initialsFor(member.fullName)}
          </div>
          <div className="min-w-0">
            <h4 className="truncate font-body text-body-lg font-bold text-on-surface">
              {member.fullName}
            </h4>
            <p className="truncate font-body text-[13px] text-on-surface-variant">
              {member.email || "No email"}
            </p>
          </div>
        </div>
        <StatusBadge status={member.status} />
      </div>

      <div className="space-y-4">
        <StaffMetaRow
          icon="call"
          label="Phone"
          value={member.phone || "Not provided"}
        />
        <StaffMetaRow
          icon="event_available"
          label="Availability"
          value={
            member.availability.length > 0
              ? member.availability.join(", ")
              : "None selected"
          }
        />
        <StaffMetaRow
          icon="calendar_today"
          label="Added"
          value={formatDate(member.createdAt)}
        />
      </div>

      <div className="mt-5 border-t border-outline-variant/50 pt-4">
        <p className="mb-2 font-body text-[12px] font-bold uppercase text-on-surface-variant">
          Skills
        </p>
        <div className="flex flex-wrap gap-2">
          {member.skills.length > 0 ? (
            member.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-body text-[12px] font-bold text-primary"
              >
                {skill}
              </span>
            ))
          ) : (
            <span className="font-body text-[13px] italic text-outline">
              No skills added
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function StaffMetaRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined mt-0.5 text-[18px] text-outline">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-body text-[11px] font-bold uppercase text-on-surface-variant">
          {label}
        </p>
        <p className="break-words font-body text-[14px] text-on-surface">
          {value}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized === "invited"
      ? "bg-primary-fixed text-on-primary-fixed"
      : normalized === "inactive"
        ? "bg-error-container text-on-error-container"
        : "bg-secondary-container/40 text-on-secondary-container";

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 font-body text-[11px] font-bold uppercase ${className}`}
    >
      {status || "active"}
    </span>
  );
}

function initialsFor(name: string) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  return initials.toUpperCase() || "ST";
}

function formatDate(value: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function StaffPreview({ form }: { form: StaffFormState }) {
  return (
    <div className="sticky top-24 rounded-xl border border-outline-variant bg-white/80 p-card-padding shadow-sm backdrop-blur">
      <div className="mb-6 flex items-center justify-between">
        <h4 className="font-body text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
          Staff Preview
        </h4>
        <span className="rounded bg-surface-container-highest px-2 py-1 font-body text-[12px] font-bold uppercase text-on-surface-variant">
          Staff
        </span>
      </div>

      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-primary-fixed-dim text-on-primary-fixed">
          <span className="material-symbols-outlined text-[48px]">person</span>
        </div>
        <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
          {form.fullName || "New Staff Member"}
        </h3>
        <p className="font-body text-body-md text-on-surface-variant">
          {form.email || "no-email@business.com"}
        </p>
      </div>

      <div className="space-y-6">
        <PreviewBlock label="Contact Details">
          <div className="flex items-center gap-3 text-on-surface">
            <span className="material-symbols-outlined text-outline">call</span>
            <span className="font-body text-body-md">
              {form.phone || "Not provided"}
            </span>
          </div>
        </PreviewBlock>

        <PreviewBlock label="Primary Skills">
          <div className="flex flex-wrap gap-2">
            {form.skills.length > 0 ? (
              form.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-body text-[13px] font-bold text-on-primary-fixed-variant"
                >
                  {skill}
                </span>
              ))
            ) : (
              <span className="font-body text-[14px] italic text-outline">
                No skills selected
              </span>
            )}
          </div>
        </PreviewBlock>

        <PreviewBlock label="Availability">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-outline">
              event_available
            </span>
            <span className="font-body text-body-md text-on-surface">
              {form.availability.length > 0
                ? form.availability.join(", ")
                : "None selected"}
            </span>
          </div>
        </PreviewBlock>
      </div>

      <div className="mt-10 rounded-lg border border-dashed border-primary-fixed/30 bg-primary-fixed/20 p-4">
        <p className="font-body text-[14px] leading-relaxed text-on-primary-fixed-variant">
          <span className="material-symbols-outlined mr-1 text-[16px]">info</span>
          Staff members are saved as staff users for this business.
        </p>
      </div>
    </div>
  );
}

function PreviewBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 font-body text-[12px] font-bold uppercase text-on-surface-variant">
        {label}
      </p>
      {children}
    </div>
  );
}

function SuccessModal({
  name,
  onAddAnother,
  onClose,
}: {
  name: string;
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
          Staff Added
        </h2>
        <p className="mb-8 font-body text-body-lg text-on-surface-variant">
          You have successfully added{" "}
          <span className="font-bold text-on-surface">{name}</span> to your
          team.
        </p>
        <button
          type="button"
          onClick={onAddAnother}
          className="w-full rounded-xl bg-primary py-4 font-body text-body-lg font-bold text-on-primary transition-all hover:bg-primary/90"
        >
          Add Another Member
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl py-3 font-body font-bold text-primary transition-all hover:bg-surface-container-low"
        >
          Back to Team
        </button>
      </div>
    </div>
  );
}
