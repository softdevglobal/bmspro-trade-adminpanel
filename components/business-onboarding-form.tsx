"use client";

import {
  AU_STATES,
  AU_TIMEZONES,
  BUSINESS_STRUCTURES,
  BUSINESS_TYPES,
  DEFAULT_AU_TIMEZONE,
  MAX_SERVICE_AREAS,
  SUBSCRIPTION_PLANS,
  ADMIN_CREATED_DEFAULT_PASSWORD,
  iconForBusinessType,
  formatAbn,
  normaliseServiceAreas,
  passwordStrength,
  titleCaseServiceArea,
  validateAccountStep,
  validateBusinessStep,
  validatePlanStep,
  type AuState,
  type AuTimezone,
  type BusinessStructure,
  type BusinessType,
  type PlanId,
} from "@/lib/onboarding/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useAuth } from "@/lib/auth/auth-context";

type Mode = "self_signup" | "super_admin_create";
export type OnboardingWizardStep = 1 | 2 | 3;
type Step = OnboardingWizardStep;

export type BusinessOnboardingFormHandle = {
  goContinue: () => void;
  goBack: () => void;
};

type Props = {
  mode: Mode;
  endpoint: string;
  submitLabel?: string;
  compact?: boolean;
  /** When true with compact, footer is rendered by the parent modal (service-template style). */
  externalFooter?: boolean;
  onSuccess?: (tenantId: string) => void;
  onStepChange?: (step: OnboardingWizardStep) => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  getRequestHeaders?: () => Promise<Record<string, string> | null>;
};

type FormState = {
  businessType: BusinessType;
  businessName: string;
  abn: string;
  businessStructure: BusinessStructure;
  registeredForGst: boolean;
  businessAddress: string;
  state: AuState;
  postcode: string;
  timezone: AuTimezone;
  businessPhone: string;
  ownerFullName: string;
  accountEmail: string;
  password: string;
  confirmPassword: string;
  selectedPlanId: PlanId | undefined;
  serviceAreas: string[];
  logoUrl: string | null;
};

const INITIAL_STATE: FormState = {
  businessType: "Plumbing",
  businessName: "",
  abn: "",
  businessStructure: "Pty Ltd",
  registeredForGst: false,
  businessAddress: "",
  state: "NSW",
  postcode: "",
  timezone: DEFAULT_AU_TIMEZONE,
  businessPhone: "",
  ownerFullName: "",
  accountEmail: "",
  password: "",
  confirmPassword: "",
  selectedPlanId: undefined,
  serviceAreas: [""],
  logoUrl: null,
};

export const ONBOARDING_WIZARD_STEPS = [
  { id: 1 as Step, label: "Business", icon: "storefront" },
  { id: 2 as Step, label: "Account", icon: "person" },
  { id: 3 as Step, label: "Plan", icon: "workspace_premium" },
] as const;

const ONBOARDING_MAX_STEP = ONBOARDING_WIZARD_STEPS.length;

/** Step intro — plain text in tenant modal; gradient banner in other compact layouts. */
function OnboardingStepIntro({
  step,
  title,
  subtitle,
  compact,
  externalFooter,
}: {
  step: Step;
  title: string;
  subtitle: string;
  compact: boolean;
  externalFooter: boolean;
}) {
  if (compact && externalFooter) {
    return (
      <>
        <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
          Step {step} of {ONBOARDING_MAX_STEP}
        </p>
        <header>
          <h3 className="font-display text-headline-sm font-semibold text-on-surface">
            {title}
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {subtitle}
          </p>
        </header>
      </>
    );
  }

  if (compact) {
    return (
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-3.5 py-3 text-on-primary">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
          Step {step} · {ONBOARDING_WIZARD_STEPS[step - 1].label}
        </p>
        <h3 className="mt-0.5 font-display text-[1.05rem] font-semibold leading-tight text-white">
          {title}
        </h3>
        <p className="mt-1 font-body text-[12px] leading-snug text-white/85">
          {subtitle}
        </p>
      </div>
    );
  }

  return (
    <header>
      <h2 className="font-display text-headline-sm font-semibold text-on-surface">
        {title}
      </h2>
      <p className="mt-1 font-body text-body-md text-on-surface-variant">
        {subtitle}
      </p>
    </header>
  );
}

/** Scrollable step body in compact modals; plain fragment on full-page onboarding. */
function OnboardingFormScrollArea({
  compact,
  externalFooter,
  children,
}: {
  compact: boolean;
  externalFooter: boolean;
  children: React.ReactNode;
}) {
  if (!compact) return <>{children}</>;

  if (externalFooter) {
    return (
      <div className="h-full min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-5">{children}</div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  );
}

export const BusinessOnboardingForm = forwardRef<
  BusinessOnboardingFormHandle,
  Props
>(function BusinessOnboardingForm(
  {
    mode,
    endpoint,
    submitLabel,
    compact = false,
    externalFooter = false,
    onSuccess,
    onStepChange,
    onSubmittingChange,
    getRequestHeaders,
  },
  ref,
) {
  const router = useRouter();
  const { login } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const requirePassword = mode === "self_signup";
  const strength = passwordStrength(form.password);
  const strengthPercent = { weak: 25, fair: 50, good: 75, strong: 100 }[strength];
  const strengthColor = {
    weak: "bg-error",
    fair: "bg-tertiary",
    good: "bg-primary",
    strong: "bg-primary",
  }[strength];

  const selectedPlan = SUBSCRIPTION_PLANS.find((p) => p.id === form.selectedPlanId);

  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);

  useEffect(() => {
    onSubmittingChange?.(isSubmitting);
  }, [isSubmitting, onSubmittingChange]);

  const completion = useMemo(() => {
    const stepBase = step === 1 ? 0 : step === 2 ? 33 : 66;
    const stepSpan = 33;

    if (step === 1) {
      const fields = [
        form.businessName.trim().length >= 2,
        form.abn.replace(/\D/g, "").length >= 2,
        form.businessPhone.trim().length >= 6,
        form.businessAddress.trim().length >= 2,
        form.postcode.length === 4,
        form.registeredForGst,
      ];
      const filled = fields.filter(Boolean).length;
      return stepBase + Math.round((filled / fields.length) * stepSpan);
    }

    if (step === 2) {
      const fields = [
        form.ownerFullName.trim().length >= 2,
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.accountEmail.trim()),
        !requirePassword || form.password.length >= 8,
        !requirePassword || form.confirmPassword.length >= 8,
      ];
      const filled = fields.filter(Boolean).length;
      return stepBase + Math.round((filled / fields.length) * stepSpan);
    }

    return form.selectedPlanId ? 100 : stepBase + 10;
  }, [form, step, requirePassword]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateServiceArea(index: number, value: string) {
    setForm((current) => {
      const next = [...current.serviceAreas];
      next[index] = titleCaseServiceArea(value);
      return { ...current, serviceAreas: next };
    });
  }

  function addServiceArea() {
    setForm((current) => {
      if (current.serviceAreas.length >= MAX_SERVICE_AREAS) return current;
      return { ...current, serviceAreas: [...current.serviceAreas, ""] };
    });
  }

  function removeServiceArea(index: number) {
    setForm((current) => {
      if (current.serviceAreas.length <= 1) {
        return { ...current, serviceAreas: [""] };
      }
      const next = current.serviceAreas.filter((_, i) => i !== index);
      return { ...current, serviceAreas: next };
    });
  }

  const [logoUploading, setLogoUploading] = useState(false);

  async function handleLogoFile(file: File) {
    setErrorMessage(null);
    setLogoUploading(true);
    try {
      const headers: Record<string, string> = {};
      if (getRequestHeaders) {
        const extra = await getRequestHeaders();
        if (extra) Object.assign(headers, extra);
      }
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/uploads/business-logo", {
        method: "POST",
        headers,
        body,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        imageUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.imageUrl) {
        throw new Error(payload.error ?? "Could not upload logo.");
      }
      update("logoUrl", payload.imageUrl);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not upload logo.",
      );
    } finally {
      setLogoUploading(false);
    }
  }

  function validateCurrentStep(): string | null {
    if (step === 1) {
      const result = validateBusinessStep(form);
      return result.ok ? null : result.error;
    }
    if (step === 2) {
      const result = validateAccountStep(form, { requirePassword });
      return result.ok ? null : result.error;
    }
    const result = validatePlanStep(form);
    return result.ok ? null : result.error;
  }

  function handleContinue() {
    setErrorMessage(null);
    const error = validateCurrentStep();
    if (error) {
      setErrorMessage(error);
      return;
    }
    if (step < 3) setStep((s) => (s + 1) as Step);
  }

  function handleBack() {
    setErrorMessage(null);
    if (step > 1) setStep((s) => (s - 1) as Step);
  }

  useImperativeHandle(ref, () => ({
    goContinue: handleContinue,
    goBack: handleBack,
  }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const error = validateCurrentStep();
    if (error) {
      setErrorMessage(error);
      return;
    }

    setIsSubmitting(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (getRequestHeaders) {
        const extra = await getRequestHeaders();
        if (extra === null) {
          setErrorMessage("Your session expired. Please sign in again.");
          setIsSubmitting(false);
          return;
        }
        Object.assign(headers, extra);
      }

      const { password, confirmPassword, ...rest } = form;
      const cleanedRest = {
        ...rest,
        serviceAreas: normaliseServiceAreas(rest.serviceAreas),
      };
      const body = requirePassword
        ? { ...cleanedRest, password, confirmPassword }
        : cleanedRest;

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        tenantId?: string;
      };

      if (!response.ok || !data.ok) {
        setErrorMessage(data.error ?? "Could not submit your details.");
        return;
      }

      if (mode === "self_signup") {
        const email = form.accountEmail.trim();
        const password = form.password;
        try {
          await login(email, password);
          return;
        } catch {
          setSuccessMessage(
            "Your account was created. Sign in with your email and password."
          );
          setForm(INITIAL_STATE);
          setStep(1);
          return;
        }
      }

      setSuccessMessage("Tenant created successfully.");
      setForm(INITIAL_STATE);
      setStep(1);

      if (onSuccess && data.tenantId) {
        onSuccess(data.tenantId);
      } else if (mode === "super_admin_create") {
        router.push("/dashboard/tenants");
        router.refresh();
      }
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const useExternalFooter = compact && externalFooter;

  return (
    <div
      className={
        compact && !externalFooter
          ? "flex h-full min-h-0 flex-col"
          : compact
            ? "h-full min-h-0"
            : "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]"
      }
    >
      <form
        id={useExternalFooter ? "tenant-onboard-form" : undefined}
        onSubmit={handleSubmit}
        className={
          useExternalFooter
            ? "h-full min-h-0 overflow-hidden"
            : compact
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "flex flex-col gap-5"
        }
        noValidate
      >
        <OnboardingFormScrollArea
          compact={compact}
          externalFooter={externalFooter}
        >
        {/* Stepper — full-page only; compact modals use header step pills */}
        {!compact ? (
        <nav
          aria-label="Onboarding progress"
          className="flex items-center justify-center gap-2 sm:gap-4"
        >
          {ONBOARDING_WIZARD_STEPS.map((s, index) => {
            const isComplete = step > s.id;
            const isActive = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2 sm:gap-4">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all ${
                      isComplete
                        ? "border-primary bg-primary text-on-primary"
                        : isActive
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant bg-surface-container-low text-on-surface-variant"
                    }`}
                  >
                    {isComplete ? (
                      <span className="material-symbols-outlined text-[20px]">
                        check
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-[20px]">
                        {s.icon}
                      </span>
                    )}
                  </div>
                  <span
                    className={`hidden font-body text-[12px] font-semibold sm:block ${
                      isActive || isComplete ? "text-primary" : "text-on-surface-variant"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {index < ONBOARDING_WIZARD_STEPS.length - 1 && (
                  <div
                    className={`mb-5 h-0.5 w-8 sm:w-16 ${
                      step > s.id ? "bg-primary" : "bg-outline-variant"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </nav>
        ) : null}

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
              error
            </span>
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-fixed/40 px-3 py-2.5 font-body text-[13px] text-on-primary-fixed-variant">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-primary">
              check_circle
            </span>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Step 1 — Business */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <OnboardingStepIntro
              step={1}
              compact={compact}
              externalFooter={externalFooter}
              title={
                compact && externalFooter
                  ? "Business details"
                  : "Tell us about your trade business"
              }
              subtitle="What trade do you specialise in?"
            />

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {BUSINESS_TYPES.map((type) => {
                const isActive = form.businessType === type.id;
                return (
                  <button
                    type="button"
                    key={type.id}
                    onClick={() => update("businessType", type.id)}
                    className={`relative flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-all ${
                      isActive
                        ? "border-2 border-primary bg-primary-fixed/40"
                        : "border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
                    }`}
                  >
                    {isActive && (
                      <span className="material-symbols-outlined material-symbols-filled absolute right-1.5 top-1.5 text-[16px] text-primary">
                        check_circle
                      </span>
                    )}
                    <span
                      className={`material-symbols-outlined text-[28px] ${
                        isActive ? "text-primary" : "text-outline"
                      }`}
                    >
                      {type.icon}
                    </span>
                    <span className="font-body text-[11px] font-semibold leading-tight text-on-surface sm:text-[12px]">
                      {type.id}
                    </span>
                  </button>
                );
              })}
            </div>

            <Field label="Business Name" required>
              <input
                type="text"
                required
                value={form.businessName}
                onChange={(e) => update("businessName", e.target.value)}
                placeholder="e.g. FlowState Plumbing"
                className={INPUT_CLASS}
              />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                <span className="material-symbols-outlined text-[16px] text-primary">
                  imagesmode
                </span>
                Business Logo
                <span className="font-normal text-outline">(optional)</span>
              </span>
              <div
                className={`flex items-center gap-4 rounded-2xl border bg-gradient-to-br from-surface-container-lowest to-surface-container-low p-4 transition-colors ${
                  form.logoUrl
                    ? "border-primary/30"
                    : "border-dashed border-outline-variant"
                }`}
              >
                <label
                  className={`group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 bg-surface-container shadow-sm transition-all ${
                    form.logoUrl
                      ? "border-white ring-1 ring-primary/20"
                      : "border-dashed border-outline-variant hover:border-primary/50 hover:bg-primary-fixed/20"
                  } ${logoUploading ? "pointer-events-none" : ""}`}
                >
                  {form.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.logoUrl}
                      alt="Business logo"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex flex-col items-center text-outline transition-colors group-hover:text-primary">
                      <span className="material-symbols-outlined text-[26px]">
                        add_photo_alternate
                      </span>
                    </span>
                  )}
                  {logoUploading ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                      <span className="material-symbols-outlined animate-spin text-[24px]">
                        progress_activity
                      </span>
                    </span>
                  ) : null}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    disabled={logoUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void handleLogoFile(file);
                    }}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[13px] font-semibold text-on-surface">
                    {form.logoUrl ? "Logo added" : "Add your logo"}
                  </p>
                  <p className="mt-0.5 font-body text-[12px] leading-snug text-on-surface-variant">
                    Shown on your booking page, dashboard, and customer emails.
                    PNG, JPG, WebP or GIF · up to 5 MB.
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <label
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 font-body text-[12px] font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary/90 ${
                        logoUploading ? "pointer-events-none opacity-60" : ""
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] ${
                          logoUploading ? "animate-spin" : ""
                        }`}
                      >
                        {logoUploading ? "progress_activity" : "upload"}
                      </span>
                      {logoUploading
                        ? "Uploading…"
                        : form.logoUrl
                          ? "Replace"
                          : "Upload logo"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="sr-only"
                        disabled={logoUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void handleLogoFile(file);
                        }}
                      />
                    </label>
                    {form.logoUrl ? (
                      <button
                        type="button"
                        onClick={() => update("logoUrl", null)}
                        className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-2.5 py-1.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:border-error/40 hover:text-error"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          delete
                        </span>
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="ABN" optional>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.abn}
                  onChange={(e) => update("abn", formatAbn(e.target.value))}
                  placeholder="12 345 678 901"
                  className={INPUT_CLASS}
                />
              </Field>
              <div className="flex flex-col gap-2">
                <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Business Structure
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {BUSINESS_STRUCTURES.map((structure) => {
                    const isActive = form.businessStructure === structure.id;
                    return (
                      <button
                        type="button"
                        key={structure.id}
                        onClick={() => update("businessStructure", structure.id)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 font-body text-[12px] font-semibold transition-all ${
                          isActive
                            ? "border-2 border-primary bg-primary-fixed/30 text-primary"
                            : "border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {structure.icon}
                        </span>
                        {structure.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="font-body text-[13px] font-semibold leading-snug text-on-surface">
                    Registered for GST?
                  </p>
                  <p className="mt-1 font-body text-[12px] leading-relaxed text-on-surface-variant">
                    Required for businesses with turnover over AU$75,000
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                  <span
                    className={`font-body text-[11px] font-bold uppercase tracking-wide ${
                      form.registeredForGst ? "text-primary" : "text-outline"
                    }`}
                  >
                    {form.registeredForGst ? "Yes" : "No"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.registeredForGst}
                    aria-label="Registered for GST"
                    onClick={() =>
                      update("registeredForGst", !form.registeredForGst)
                    }
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                      form.registeredForGst ? "bg-primary" : "bg-outline-variant/80"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                        form.registeredForGst ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            <SectionDivider label="Location details" />

            <Field label="Business Address" optional>
              <input
                type="text"
                value={form.businessAddress}
                onChange={(e) => update("businessAddress", e.target.value)}
                placeholder="Street address"
                className={INPUT_CLASS}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="State" required>
                <SelectInput
                  value={form.state}
                  onChange={(e) => update("state", e.target.value as AuState)}
                >
                  {AU_STATES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label="Postcode" required>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  value={form.postcode}
                  onChange={(e) =>
                    update("postcode", e.target.value.replace(/\D/g, ""))
                  }
                  placeholder="2000"
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label="Timezone" required>
                <SelectInput
                  value={form.timezone}
                  onChange={(e) =>
                    update("timezone", e.target.value as AuTimezone)
                  }
                >
                  {AU_TIMEZONES.map((tz) => (
                    <option key={tz.id} value={tz.id}>
                      {tz.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>

            <Field label="Business Phone" required>
              <div className="flex overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                <span className="flex items-center border-r border-outline-variant bg-surface-container px-3 font-body text-[13px] font-semibold text-on-surface-variant">
                  +61
                </span>
                <input
                  type="tel"
                  required
                  value={form.businessPhone}
                  onChange={(e) => update("businessPhone", e.target.value)}
                  placeholder="400 000 000"
                  className="h-12 min-w-0 flex-1 bg-transparent px-4 font-body text-body-md text-on-surface placeholder:text-outline focus:outline-none"
                />
              </div>
            </Field>

            <SectionDivider label="Service areas" />

            <ServiceAreasField
              values={form.serviceAreas}
              onUpdate={updateServiceArea}
              onAdd={addServiceArea}
              onRemove={removeServiceArea}
            />
          </div>
        )}

        {/* Step 2 — Account */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <OnboardingStepIntro
              step={2}
              compact={compact}
              externalFooter={externalFooter}
              title={
                compact && externalFooter ? "Account details" : "Create your account"
              }
              subtitle={
                requirePassword
                  ? "Set up login credentials for your admin portal."
                  : "Enter the business owner contact details."
              }
            />

            <Field label="Your Full Name" required>
              <input
                type="text"
                required
                value={form.ownerFullName}
                onChange={(e) => update("ownerFullName", e.target.value)}
                placeholder="e.g. John Smith"
                className={INPUT_CLASS}
              />
            </Field>

            <Field label="Email Address" required>
              <input
                type="email"
                required
                value={form.accountEmail}
                onChange={(e) => update("accountEmail", e.target.value)}
                placeholder="admin@business.com"
                className={INPUT_CLASS}
              />
            </Field>

            {!requirePassword && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary-fixed/35 px-3 py-2.5 font-body text-[13px] text-on-primary-fixed-variant">
                <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[18px] text-primary">
                  lock
                </span>
                <p>
                  A login account will be created automatically. Default
                  password:{" "}
                  <span className="font-semibold text-on-surface">
                    {ADMIN_CREATED_DEFAULT_PASSWORD}
                  </span>
                  . Share this with the business owner to sign in.
                </p>
              </div>
            )}

            {requirePassword && (
              <>
                <Field label="Password" required>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={form.password}
                      onChange={(e) => update("password", e.target.value)}
                      placeholder="Create a password"
                      className={`${INPUT_CLASS} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                  {form.password.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-variant">
                        <div
                          className={`h-full rounded-full transition-all ${strengthColor}`}
                          style={{ width: `${strengthPercent}%` }}
                        />
                      </div>
                      <span className="font-body text-[12px] font-semibold capitalize text-on-surface-variant">
                        {strength}
                      </span>
                    </div>
                  )}
                </Field>

                <Field label="Confirm Password" required>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={form.confirmPassword}
                    onChange={(e) => update("confirmPassword", e.target.value)}
                    placeholder="Re-enter your password"
                    className={INPUT_CLASS}
                  />
                </Field>
              </>
            )}

            <BusinessSummaryCard form={form} />
          </div>
        )}

        {/* Step 3 — Plan */}
        {step === 3 && (
          <div className="flex flex-col gap-5">
            <OnboardingStepIntro
              step={3}
              compact={compact}
              externalFooter={externalFooter}
              title={compact && externalFooter ? "Plan details" : "Choose your plan"}
              subtitle="Select a subscription plan for this trade business."
            />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {SUBSCRIPTION_PLANS.map((plan) => {
                const isActive = form.selectedPlanId === plan.id;
                return (
                  <button
                    type="button"
                    key={plan.id}
                    onClick={() => update("selectedPlanId", plan.id)}
                    className={`flex flex-col rounded-xl border p-4 text-left transition-all ${
                      isActive
                        ? "border-2 border-primary bg-primary-fixed/20 shadow-md shadow-primary/10"
                        : "border-outline-variant bg-surface-container-lowest hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-[15px] font-semibold text-on-surface">
                        {plan.name}
                      </h3>
                      {plan.trialDays && (
                        <span className="shrink-0 rounded-full bg-primary-fixed px-2 py-0.5 font-body text-[10px] font-bold text-primary">
                          {plan.trialDays}-day free trial
                        </span>
                      )}
                    </div>
                    <p className="mt-2 font-display text-[22px] font-bold text-on-surface">
                      AU${plan.price}
                      <span className="font-body text-[13px] font-normal text-on-surface-variant">
                        /{plan.period}
                      </span>
                    </p>
                    <p className="font-body text-[12px] text-on-surface-variant">
                      {plan.billingNote}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 font-body text-[12px] text-on-surface-variant">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">
                          store
                        </span>
                        {plan.branches} Branch
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">
                          group
                        </span>
                        {plan.staff} Staff
                      </span>
                    </div>
                    {plan.description && (
                      <p className="mt-3 border-t border-outline-variant pt-3 font-body text-[12px] leading-relaxed text-on-surface-variant">
                        {plan.description}
                      </p>
                    )}
                    <span
                      className={`mt-4 inline-flex h-9 items-center justify-center rounded-lg font-body text-[13px] font-semibold ${
                        isActive
                          ? "bg-primary text-on-primary"
                          : "bg-surface-container text-on-surface"
                      }`}
                    >
                      {isActive ? "Selected" : "Select Plan"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </OnboardingFormScrollArea>

        {!useExternalFooter ? (
        /* Footer actions — inline when not using modal footer */
        <div
          className={
            compact
              ? `flex shrink-0 items-center gap-3 border-t border-outline-variant bg-background py-3 shadow-[0_-8px_24px_rgba(0,42,150,0.08)] -mx-5 px-5 sm:-mx-6 sm:px-6 ${
                  step === 1 && mode !== "self_signup"
                    ? "justify-end"
                    : "justify-between"
                }`
              : "flex flex-col-reverse items-stretch justify-between gap-3 border-t border-outline-variant pt-4 sm:flex-row sm:items-center"
          }
        >
          {step === 1 ? (
            mode === "self_signup" ? (
              <Link
                href="/login"
                className="inline-flex items-center gap-1 font-body text-[13px] font-semibold text-on-surface-variant hover:text-primary"
              >
                <span className="material-symbols-outlined text-[18px]">
                  arrow_back
                </span>
                Back to Sign In
              </Link>
            ) : compact ? null : (
              <span />
            )
          ) : (
            <button
              type="button"
              onClick={handleBack}
              className={
                compact
                  ? "rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
                  : "inline-flex items-center gap-1 font-body text-[13px] font-semibold text-on-surface-variant hover:text-primary"
              }
            >
              {compact ? (
                "Back"
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">
                    arrow_back
                  </span>
                  Back
                </>
              )}
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleContinue}
              className={
                compact
                  ? "flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary"
                  : "flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
              }
            >
              Continue
              <span className="material-symbols-outlined text-[18px]">
                arrow_forward
              </span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSubmitting}
              className={
                compact
                  ? "flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
                  : "flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              }
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                  Submitting...
                </>
              ) : (
                <>
                  {submitLabel ??
                    (mode === "self_signup" ? "Submit Request" : "Create Tenant")}
                  <span className="material-symbols-outlined text-[18px]">
                    arrow_forward
                  </span>
                </>
              )}
            </button>
          )}
        </div>
        ) : null}

        {mode === "self_signup" && step === 3 && !useExternalFooter && (
          <p
            className={
              compact
                ? "shrink-0 text-center font-body text-[11px] text-on-surface-variant -mt-1 pb-1"
                : "text-center font-body text-[12px] text-on-surface-variant"
            }
          >
            By creating an account, you agree to our Terms of Service and Privacy
            Policy.
          </p>
        )}
      </form>

      {!compact && (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <PreviewPanel form={form} step={step} completion={completion} mode={mode} selectedPlan={selectedPlan} />
        </aside>
      )}
    </div>
  );
});

function PreviewPanel({
  form,
  step,
  completion,
  mode,
  selectedPlan,
}: {
  form: FormState;
  step: Step;
  completion: number;
  mode: Mode;
  selectedPlan: (typeof SUBSCRIPTION_PLANS)[number] | undefined;
}) {
  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-primary opacity-5"
        />
        <p className="mb-4 font-body text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
          Live Preview
        </p>

        <div className="relative z-10 mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-surface-container text-primary shadow-sm">
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.logoUrl}
                alt={form.businessName || "Business logo"}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="material-symbols-outlined material-symbols-filled text-[36px]">
                {iconForBusinessType(form.businessType)}
              </span>
            )}
          </div>
          <h3 className="text-center font-display text-headline-sm font-semibold text-on-surface">
            {form.businessName || "Your Business Name"}
          </h3>
          {form.abn.trim() ? (
            <p className="mt-1 font-body text-[12px] text-on-surface-variant">
              ABN {form.abn}
            </p>
          ) : null}
          <span className="mt-2 inline-block rounded-full bg-primary-fixed px-3 py-1 font-body text-[12px] font-semibold text-primary">
            {form.businessType}
          </span>
        </div>

        <div className="space-y-3 border-t border-outline-variant pt-5 font-body text-body-md text-on-surface-variant">
          <PreviewRow
            icon="badge"
            value={form.abn}
            placeholder="No ABN added"
          />
          <PreviewRow icon="call" value={form.businessPhone ? `+61 ${form.businessPhone}` : ""} placeholder="No phone added" />
          <PreviewRow icon="mail" value={form.accountEmail} placeholder="No email added" />
          <PreviewRow
            icon="location_on"
            value={
              form.state && form.postcode
                ? `${form.state}, ${form.postcode}`
                : ""
            }
            placeholder="No location set"
          />
          <PreviewRow
            icon="person"
            value={form.ownerFullName}
            placeholder="No name added"
          />
          {selectedPlan && step === 3 && (
            <PreviewRow icon="workspace_premium" value={selectedPlan.name} placeholder="" />
          )}
        </div>

        {(() => {
          const areas = form.serviceAreas
            .map((a) => a.trim())
            .filter(Boolean);
          if (areas.length === 0) return null;
          return (
            <div className="mt-5 border-t border-outline-variant pt-4">
              <p className="mb-2 flex items-center gap-1.5 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                <span className="material-symbols-outlined text-[14px] text-primary">
                  radar
                </span>
                Service areas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {areas.slice(0, 8).map((area) => (
                  <span
                    key={area}
                    className="inline-flex items-center rounded-full bg-primary-fixed px-2.5 py-0.5 font-body text-[11px] font-semibold text-primary"
                  >
                    {area}
                  </span>
                ))}
                {areas.length > 8 && (
                  <span className="inline-flex items-center rounded-full bg-surface-container px-2.5 py-0.5 font-body text-[11px] font-semibold text-on-surface-variant">
                    +{areas.length - 8}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between font-body text-[12px] font-semibold text-on-surface-variant">
            <span>Step {step} of 3</span>
            <span className="text-primary">{completion}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-variant">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>
      </div>

      <ContextualProTip form={form} step={step} mode={mode} />
    </>
  );
}

function ContextualProTip({
  form,
  step,
  mode,
}: {
  form: FormState;
  step: Step;
  mode: Mode;
}) {
  const tip = useMemo(() => {
    if (step === 1) {
      if (form.businessName.trim().length < 2) {
        return {
          icon: "storefront",
          label: "Step 1 · Business",
          title: "Start with your business name",
          message:
            "Pick the trade you specialise in and add your registered business name first.",
        };
      }
      if (form.postcode.length !== 4 || !form.businessAddress.trim()) {
        return {
          icon: "location_on",
          label: "Step 1 · Location",
          title: "Add your base location",
          message:
            "We use your address and postcode to set the centre of your service area.",
        };
      }
      const filledAreas = form.serviceAreas.filter(
        (a) => a.trim().length >= 2
      ).length;
      if (filledAreas === 0) {
        return {
          icon: "radar",
          label: "Step 1 · Service areas",
          title: "List the suburbs you cover",
          message:
            "Reception will use these to confirm whether a customer is inside your service area.",
        };
      }
      return {
        icon: "check_circle",
        label: "Step 1 · Looking good",
        title: "Business details complete",
        message: "Tap Continue to set up your owner account.",
      };
    }

    if (step === 2) {
      if (form.ownerFullName.trim().length < 2) {
        return {
          icon: "person",
          label: "Step 2 · Account",
          title: "Tell us who's in charge",
          message:
            "Add the business owner's full name — it appears on every invoice and booking.",
        };
      }
      if (mode === "self_signup") {
        if (form.password.length < 8) {
          return {
            icon: "lock",
            label: "Step 2 · Security",
            title: "Pick a strong password",
            message:
              "At least 8 characters. Mix letters, numbers, and a symbol for the best protection.",
          };
        }
        if (form.password !== form.confirmPassword) {
          return {
            icon: "rule",
            label: "Step 2 · Confirm",
            title: "Re-enter your password",
            message:
              "Both passwords must match before you can continue to your plan.",
          };
        }
      }
      return {
        icon: "mark_email_read",
        label: "Step 2 · Almost there",
        title: "Account ready",
        message:
          mode === "self_signup"
            ? "Continue to choose the plan that fits your team."
            : "The owner will sign in with the default password 00001111.",
      };
    }

    // Step 3 — Plan
    if (!form.selectedPlanId) {
      return {
        icon: "workspace_premium",
        label: "Step 3 · Plan",
        title: "Choose what suits your team",
        message:
          "Trade Pro is the most popular — full job tracking, quotes, and invoices.",
      };
    }
    return {
      icon: "rocket_launch",
      label: "Step 3 · Ready to launch",
      title:
        mode === "self_signup"
          ? "You're one tap away"
          : "Tenant ready to create",
      message:
        mode === "self_signup"
          ? "Submit to activate your dashboard and sign in straight away."
          : "Submit to provision the business — the owner can sign in immediately.",
    };
  }, [form, step, mode]);

  return (
    <div
      key={tip.title}
      className="mt-4 overflow-hidden rounded-2xl bg-primary p-5 text-on-primary"
    >
      <div className="flex items-center gap-2 opacity-90">
        <span className="material-symbols-outlined material-symbols-filled text-[18px]">
          {tip.icon}
        </span>
        <p className="font-body text-[11px] font-bold uppercase tracking-wider">
          {tip.label}
        </p>
      </div>
      <p className="mt-2 font-display text-[16px] font-semibold leading-tight">
        {tip.title}
      </p>
      <p className="mt-1.5 font-body text-[13px] leading-relaxed opacity-90">
        {tip.message}
      </p>
    </div>
  );
}

function BusinessSummaryCard({ form }: { form: FormState }) {
  return (
    <div className="rounded-xl bg-on-surface p-4 text-surface-container-lowest">
      <div className="mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-[20px]">store</span>
        <span className="font-body text-[13px] font-semibold">
          Business Summary
        </span>
      </div>
      <dl className="space-y-2 font-body text-[13px]">
        <div className="flex justify-between gap-4">
          <dt className="text-surface-container-high">Business</dt>
          <dd className="font-semibold">{form.businessName || "—"}</dd>
        </div>
        {form.abn.trim() ? (
          <div className="flex justify-between gap-4">
            <dt className="text-surface-container-high">ABN</dt>
            <dd className="font-semibold">{form.abn}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-surface-container-high">Type</dt>
          <dd className="text-right font-semibold">{form.businessType}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-surface-container-high">Location</dt>
          <dd className="font-semibold">
            {form.state && form.postcode
              ? `${form.state}, ${form.postcode}`
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

const INPUT_CLASS =
  "h-12 w-full rounded-lg border border-outline-variant bg-surface-container-low px-4 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

const SELECT_CLASS =
  "h-12 w-full appearance-none rounded-lg border border-outline-variant bg-surface-container-low pl-4 pr-10 font-body text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all";

function SelectInput({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} className={SELECT_CLASS}>
        {children}
      </select>
      <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[22px] text-outline">
        expand_more
      </span>
    </div>
  );
}

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
        {optional && (
          <span className="font-normal text-outline"> (Optional)</span>
        )}
      </span>
      {children}
    </label>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-outline-variant" />
      <span className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <div className="h-px flex-1 bg-outline-variant" />
    </div>
  );
}

function ServiceAreasField({
  values,
  onUpdate,
  onAdd,
  onRemove,
}: {
  values: string[];
  onUpdate: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const filled = values.filter((v) => v.trim().length >= 2).length;
  const canAdd = values.length < MAX_SERVICE_AREAS;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary-fixed/30 px-3 py-2.5">
        <span className="material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[20px] text-primary">
          radar
        </span>
        <p className="font-body text-[12px] text-on-surface-variant">
          List the suburbs, towns, or regions you cover. Reception uses these
          to confirm whether a job address is inside your service area. Add as
          many as you need.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {values.map((value, index) => {
          const isOnlyRow = values.length === 1;
          return (
            <div key={index} className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">
                  location_on
                </span>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => onUpdate(index, e.target.value)}
                  autoCapitalize="words"
                  spellCheck={false}
                  placeholder={
                    index === 0
                      ? "e.g. Lynbrook 3975"
                      : "Another suburb, town, or region"
                  }
                  className={`h-12 w-full rounded-lg border border-outline-variant bg-surface-container-low pl-10 pr-3 font-body text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20`}
                />
              </div>
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={isOnlyRow && !value.trim()}
                aria-label={`Remove service area ${index + 1}`}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-outline-variant text-on-surface-variant transition-colors hover:border-error/40 hover:bg-error-container/40 hover:text-error disabled:opacity-40 disabled:hover:border-outline-variant disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-[20px]">
                  close
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-primary/40 bg-primary-fixed/40 px-3 py-2 font-body text-[12px] font-semibold text-primary transition-colors hover:bg-primary-fixed/70 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add another area
        </button>
        <span className="font-body text-[11px] text-on-surface-variant">
          {filled} added · max {MAX_SERVICE_AREAS}
        </span>
      </div>
    </div>
  );
}

function PreviewRow({
  icon,
  value,
  placeholder,
}: {
  icon: string;
  value: string;
  placeholder: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined mt-0.5 text-[18px] text-on-surface-variant">
        {icon}
      </span>
      <span
        className={`min-w-0 truncate font-body text-[13px] ${
          value ? "text-on-surface" : "text-on-surface-variant"
        }`}
      >
        {value || placeholder}
      </span>
    </div>
  );
}
