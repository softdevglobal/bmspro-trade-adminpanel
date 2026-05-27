"use client";

import {
  AU_STATES,
  AU_TIMEZONES,
  BUSINESS_STRUCTURES,
  BUSINESS_TYPES,
  SUBSCRIPTION_PLANS,
  ADMIN_CREATED_DEFAULT_PASSWORD,
  iconForBusinessType,
  formatAbn,
  passwordStrength,
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
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";

type Mode = "self_signup" | "super_admin_create";
type Step = 1 | 2 | 3;

type Props = {
  mode: Mode;
  endpoint: string;
  submitLabel?: string;
  compact?: boolean;
  onSuccess?: (tenantId: string) => void;
  onStepChange?: (step: Step) => void;
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
  timezone: "Australia/Sydney",
  businessPhone: "",
  ownerFullName: "",
  accountEmail: "",
  password: "",
  confirmPassword: "",
  selectedPlanId: undefined,
};

const STEPS = [
  { id: 1 as Step, label: "Business", icon: "storefront" },
  { id: 2 as Step, label: "Account", icon: "person" },
  { id: 3 as Step, label: "Plan", icon: "workspace_premium" },
];

export function BusinessOnboardingForm({
  mode,
  endpoint,
  submitLabel,
  compact = false,
  onSuccess,
  onStepChange,
  getRequestHeaders,
}: Props) {
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
      const body = requirePassword
        ? { ...rest, password, confirmPassword }
        : rest;

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

  return (
    <div
      className={
        compact
          ? "flex flex-col gap-5"
          : "grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]"
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {/* Stepper */}
        <nav
          aria-label="Onboarding progress"
          className="flex items-center justify-center gap-2 sm:gap-4"
        >
          {STEPS.map((s, index) => {
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
                {index < STEPS.length - 1 && (
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
            <header>
              <h2 className="font-display text-headline-sm font-semibold text-on-surface">
                Tell us about your trade business
              </h2>
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                What trade do you specialise in?
              </p>
            </header>

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
          </div>
        )}

        {/* Step 2 — Account */}
        {step === 2 && (
          <div className="flex flex-col gap-5">
            <header>
              <h2 className="font-display text-headline-sm font-semibold text-on-surface">
                Create your account
              </h2>
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                {requirePassword
                  ? "Set up login credentials for your admin portal."
                  : "Enter the business owner contact details."}
              </p>
            </header>

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
            <header>
              <h2 className="font-display text-headline-sm font-semibold text-on-surface">
                Choose your plan
              </h2>
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                Select a subscription plan for your trade business.
              </p>
            </header>

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

        {/* Footer actions */}
        <div className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-outline-variant pt-4 sm:flex-row sm:items-center">
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
            ) : (
              <span />
            )
          ) : (
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1 font-body text-[13px] font-semibold text-on-surface-variant hover:text-primary"
            >
              <span className="material-symbols-outlined text-[18px]">
                arrow_back
              </span>
              Back
            </button>
          )}

          {step < 3 ? (
            <button
              type="button"
              onClick={handleContinue}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
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
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 font-body text-label-bold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
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

        {mode === "self_signup" && step === 3 && (
          <p className="text-center font-body text-[12px] text-on-surface-variant">
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
}

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
          <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-surface-container text-primary shadow-sm">
            <span className="material-symbols-outlined material-symbols-filled text-[36px]">
              {iconForBusinessType(form.businessType)}
            </span>
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

      <div className="mt-4 overflow-hidden rounded-2xl bg-primary p-5 text-on-primary">
        <p className="font-body text-[12px] font-semibold uppercase tracking-wider opacity-90">
          Pro tip
        </p>
        <p className="mt-1 font-body text-body-md leading-relaxed opacity-95">
          {mode === "self_signup"
            ? "You're almost done — finish onboarding to access your dashboard."
            : "The tenant is created immediately and activated for use."}
        </p>
      </div>
    </>
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
