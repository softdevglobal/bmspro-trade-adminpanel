"use client";

import { PlanBuildWizardShell, PLAN_WIZARD_FIELD_CLASS, PLAN_WIZARD_TEXTAREA_CLASS } from "@/components/plan-build-wizard-shell";
import { PackageWizardStepIntro } from "@/components/package-wizard-step-intro";
import {
  formatMessageQuotaLabel,
  formatSmsPriceLabel,
  validateSmsPackageDescription,
} from "@/lib/sms-packages/helpers";
import type { SmsPackage } from "@/lib/sms-packages/types";
import {
  PLAN_THEME_OPTIONS,
  planThemeGradient,
  type PlanThemeId,
} from "@/lib/subscription-plans/theme";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

const SMS_PACKAGE_MAX_STEP = 4;
type SmsPackageStep = 1 | 2 | 3 | 4;

const SMS_STEP_META: Record<SmsPackageStep, { title: string; subtitle: string }> = {
  1: {
    title: "Basic info",
    subtitle: "Set the SMS package name, price, and description.",
  },
  2: {
    title: "SMS limits",
    subtitle: "Message quota and plan key for this SMS add-on.",
  },
  3: {
    title: "Features & appearance",
    subtitle: "Feature list and theme colour for the package card.",
  },
  4: {
    title: "Review & preview",
    subtitle: "Check how this SMS package will appear before saving.",
  },
};

function validateSmsPackageStep(
  form: SmsPackageFormState,
  step: SmsPackageStep,
): string | null {
  if (step === 1) {
    if (!form.name.trim()) return "SMS package name is required.";
    const description = validateSmsPackageDescription(form.description);
    return description.ok ? null : description.error;
  }
  return null;
}

export type SmsPackageFormState = {
  name: string;
  price: string;
  priceLabel: string;
  messageQuota: string;
  unlimitedMessages: boolean;
  plan_key: string;
  description: string;
  featuresText: string;
  popular: boolean;
  active: boolean;
  hidden: boolean;
  stripePriceId: string;
  color: PlanThemeId;
  image: string;
};

export const EMPTY_SMS_PACKAGE_FORM: SmsPackageFormState = {
  name: "",
  price: "29",
  priceLabel: "AU$29",
  messageQuota: "100",
  unlimitedMessages: false,
  plan_key: "SMS_BASIC",
  description: "",
  featuresText:
    "100 SMS messages\nTransactional notifications\nCustomer alerts",
  popular: false,
  active: true,
  hidden: false,
  stripePriceId: "",
  color: "teal",
  image: "",
};

export function smsPackageFormFromPlan(pkg: SmsPackage): SmsPackageFormState {
  return {
    name: pkg.name,
    price: String(pkg.price),
    priceLabel: pkg.priceLabel,
    messageQuota: pkg.messageQuota < 0 ? "100" : String(pkg.messageQuota),
    unlimitedMessages: pkg.messageQuota < 0,
    plan_key: pkg.plan_key ?? "",
    description: pkg.description ?? "",
    featuresText: pkg.features.join("\n"),
    popular: pkg.popular,
    active: pkg.active,
    hidden: pkg.hidden,
    stripePriceId: pkg.stripePriceId ?? "",
    color: (pkg.color as PlanThemeId) || "teal",
    image: pkg.image ?? "",
  };
}

export function validateSmsPackageForm(form: SmsPackageFormState): string | null {
  if (!form.name.trim()) return "SMS package name is required.";
  const description = validateSmsPackageDescription(form.description);
  return description.ok ? null : description.error;
}

export function smsPackageBodyFromForm(form: SmsPackageFormState, id?: string) {
  const price = Number.parseFloat(form.price) || 0;
  const autoLabel = formatSmsPriceLabel(price);

  return {
    ...(id ? { id } : {}),
    name: form.name.trim(),
    price,
    priceLabel: form.priceLabel.trim() || autoLabel,
    messageQuota: form.unlimitedMessages
      ? -1
      : Number.parseInt(form.messageQuota, 10) || 100,
    plan_key: form.plan_key.trim() || null,
    description: form.description.trim(),
    features: form.featuresText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    popular: form.popular,
    active: form.active,
    hidden: form.hidden,
    stripePriceId: null,
    color: form.color,
    image: form.image.trim() || "",
    icon: "sms",
  };
}

type Props = {
  open: boolean;
  editingId: string | null;
  form: SmsPackageFormState;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onFormChange: (next: SmsPackageFormState) => void;
  onDelete?: () => void;
};

function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
      {children}
      {required ? <span className="text-error"> *</span> : null}
    </span>
  );
}

export function SmsPackageBuildModal({
  open,
  editingId,
  form,
  saving,
  onClose,
  onSave,
  onFormChange,
  onDelete,
}: Props) {
  const [step, setStep] = useState<SmsPackageStep>(1);
  const [stepError, setStepError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setStepError(null);
    }
  }, [open, editingId]);

  const previewPrice =
    form.priceLabel.trim() ||
    formatSmsPriceLabel(Number.parseFloat(form.price) || 0);
  const messageCount = form.unlimitedMessages
    ? -1
    : Number.parseInt(form.messageQuota, 10) || 100;

  const previewFeatures = useMemo(
    () =>
      form.featuresText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [form.featuresText],
  );

  function set<K extends keyof SmsPackageFormState>(
    key: K,
    value: SmsPackageFormState[K],
  ) {
    onFormChange({ ...form, [key]: value });
  }

  function handleContinue() {
    setStepError(null);
    const error = validateSmsPackageStep(form, step);
    if (error) {
      setStepError(error);
      return;
    }
    if (step < SMS_PACKAGE_MAX_STEP) {
      setStep((current) => (current + 1) as SmsPackageStep);
    }
  }

  function handleBack() {
    setStepError(null);
    if (step > 1) setStep((current) => (current - 1) as SmsPackageStep);
  }

  function handleSubmit() {
    setStepError(null);
    for (let current = 1; current <= SMS_PACKAGE_MAX_STEP; current++) {
      const error = validateSmsPackageStep(form, current as SmsPackageStep);
      if (error) {
        setStepError(error);
        setStep(current as SmsPackageStep);
        return;
      }
    }
    const validationError = validateSmsPackageForm(form);
    if (validationError) {
      setStepError(validationError);
      return;
    }
    onSave();
  }

  const stepMeta = SMS_STEP_META[step];

  return (
    <PlanBuildWizardShell
      open={open}
      title={editingId ? "Edit SMS package" : "Build SMS package"}
      subtitle="Create an SMS add-on bundled with subscription plans."
      step={step}
      maxStep={SMS_PACKAGE_MAX_STEP}
      stepError={stepError}
      saving={saving}
      editingId={editingId}
      onClose={onClose}
      onBack={handleBack}
      onContinue={handleContinue}
      onSubmit={handleSubmit}
      onDelete={onDelete}
      submitLabel={editingId ? "Save package" : "Create package"}
    >
      <PackageWizardStepIntro
        step={step}
        maxStep={SMS_PACKAGE_MAX_STEP}
        title={stepMeta.title}
        subtitle={stepMeta.subtitle}
      />

      {step === 1 ? (
        <div className="space-y-4">
          <label className="block">
            <FieldLabel required>Package name</FieldLabel>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. SMS Basic, SMS Pro"
              className={PLAN_WIZARD_FIELD_CLASS}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <FieldLabel required>Price (AUD)</FieldLabel>
              <input
                type="number"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                className={PLAN_WIZARD_FIELD_CLASS}
              />
            </label>
            <label className="block">
              <FieldLabel>Display label</FieldLabel>
              <input
                value={form.priceLabel}
                onChange={(e) => set("priceLabel", e.target.value)}
                placeholder="AU$29"
                className={PLAN_WIZARD_FIELD_CLASS}
              />
            </label>
          </div>
          <label className="block">
            <FieldLabel required>Description</FieldLabel>
            <textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              className={PLAN_WIZARD_TEXTAREA_CLASS}
            />
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          <div>
            <FieldLabel>Message quota</FieldLabel>
            <input
              type="number"
              disabled={form.unlimitedMessages}
              value={form.messageQuota}
              onChange={(e) => set("messageQuota", e.target.value)}
              className={PLAN_WIZARD_FIELD_CLASS}
            />
            <label className="mt-2 inline-flex items-center gap-2 font-body text-[12px] text-on-surface-variant">
              <input
                type="checkbox"
                checked={form.unlimitedMessages}
                onChange={(e) => set("unlimitedMessages", e.target.checked)}
              />
              Unlimited messages
            </label>
          </div>
          <label className="block">
            <FieldLabel>Plan key</FieldLabel>
            <input
              value={form.plan_key}
              onChange={(e) => set("plan_key", e.target.value)}
              placeholder="SMS_BASIC"
              className={PLAN_WIZARD_FIELD_CLASS}
            />
          </label>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6">
          <label className="block">
            <FieldLabel>Features</FieldLabel>
            <textarea
              value={form.featuresText}
              onChange={(e) => set("featuresText", e.target.value)}
              rows={5}
              className={PLAN_WIZARD_TEXTAREA_CLASS}
            />
          </label>
          <div>
            <FieldLabel>Theme colour</FieldLabel>
            <div className="mt-2 flex flex-wrap gap-2">
              {PLAN_THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.label}
                  onClick={() => set("color", opt.id)}
                  className={`h-9 w-9 rounded-full bg-gradient-to-br ${opt.gradient} ring-offset-2 transition-all ${
                    form.color === opt.id
                      ? `ring-2 ${opt.ring}`
                      : "opacity-80 hover:opacity-100"
                  }`}
                  aria-label={opt.label}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
            <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Visibility & status
            </p>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {form.active ? "Active — visible to workshops" : "Inactive — hidden from signup"}
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                checked={form.hidden}
                onChange={(e) => set("hidden", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Hidden from public list
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[13px] text-on-surface">
              <input
                type="checkbox"
                checked={form.popular}
                onChange={(e) => set("popular", e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Mark as most popular
            </label>
          </div>

          <div>
            <p className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
              Live preview
            </p>
            <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface shadow-sm">
              <div
                className={`relative bg-gradient-to-br ${planThemeGradient(form.color)} px-4 py-5 text-white`}
              >
                {form.popular ? (
                  <span className="absolute right-3 top-3 rounded-full bg-white/20 px-2 py-0.5 font-body text-[10px] font-bold uppercase">
                    Most Popular
                  </span>
                ) : null}
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                  <span className="material-symbols-outlined text-[26px]">sms</span>
                </div>
                <p className="mt-4 font-display text-[16px] font-bold leading-tight">
                  {form.name.trim() || "SMS package"}
                </p>
                <p className="mt-1 font-display text-[22px] font-bold">{previewPrice}</p>
                <p className="mt-3 font-body text-[11px] text-white/90">
                  {formatMessageQuotaLabel(messageCount)}
                </p>
              </div>
              {previewFeatures.length > 0 ? (
                <ul className="space-y-2 px-4 py-3">
                  {previewFeatures.slice(0, 4).map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 font-body text-[12px] text-on-surface-variant"
                    >
                      <span className="material-symbols-outlined mt-0.5 text-[14px] text-primary">
                        check_circle
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </PlanBuildWizardShell>
  );
}
