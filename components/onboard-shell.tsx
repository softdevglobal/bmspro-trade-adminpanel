"use client";

import { BusinessOnboardingForm } from "@/components/business-onboarding-form";
import Link from "next/link";
import { useState } from "react";

type OnboardStep = 1 | 2 | 3;

const STEPS = [
  { id: 1 as OnboardStep, label: "Business", icon: "storefront" },
  { id: 2 as OnboardStep, label: "Account", icon: "person" },
  { id: 3 as OnboardStep, label: "Plan", icon: "workspace_premium" },
];

const STEP_COPY: Record<
  OnboardStep,
  { title: string; description: string }
> = {
  1: {
    title: "Tell us about your trade business",
    description:
      "Add your business details — trade type, location and contact info.",
  },
  2: {
    title: "Create your account",
    description:
      "Set up login credentials. You'll be signed in when onboarding is complete.",
  },
  3: {
    title: "Choose your plan",
    description: "Select a subscription plan for your trade business.",
  },
};

export function OnboardShell() {
  const [step, setStep] = useState<OnboardStep>(1);
  const copy = STEP_COPY[step];
  const progressPercent = Math.round((step / 3) * 100);

  return (
    <div className="min-h-dvh bg-background text-on-background">
      <header className="sticky top-0 z-40 border-b border-outline-variant bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-container-max items-center justify-between px-4 sm:px-gutter">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-on-primary">
              <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                architecture
              </span>
            </div>
            <span className="font-display text-headline-sm text-headline-sm font-bold text-primary">
              BMS Pro Trade
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full bg-surface-container-low px-4 py-2 sm:flex">
              <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-variant">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="font-body text-[12px] font-semibold text-primary">
                Step {step} of 3
              </span>
            </div>
            <Link
              href="/login"
              className="font-body text-[13px] font-semibold text-primary hover:text-primary-container"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-container-max gap-gutter px-4 py-8 sm:px-gutter sm:py-10">
        <aside className="hidden w-[260px] shrink-0 flex-col gap-4 lg:flex">
          <div>
            <h3 className="mb-2 px-3 font-body text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Onboarding Steps
            </h3>
            <nav className="flex flex-col gap-1">
              {STEPS.map((item) => {
                const isComplete = step > item.id;
                const isActive = step === item.id;

                return (
                  <div
                    key={item.label}
                    className={
                      isActive
                        ? "flex items-center gap-3 rounded-xl border border-primary/20 bg-secondary-fixed px-3 py-3 text-on-secondary-fixed-variant"
                        : isComplete
                          ? "flex items-center gap-3 rounded-xl px-3 py-3 text-on-surface"
                          : "flex items-center gap-3 rounded-xl px-3 py-3 text-on-surface-variant opacity-60"
                    }
                  >
                    <span
                      className={`material-symbols-outlined ${
                        isActive || isComplete
                          ? "material-symbols-filled text-primary"
                          : "text-on-surface-variant"
                      }`}
                    >
                      {isComplete ? "check_circle" : item.icon}
                    </span>
                    <span className="font-body text-[14px] font-semibold">
                      {item.label}
                    </span>
                    {isActive && (
                      <span className="material-symbols-outlined ml-auto text-[16px] text-primary">
                        arrow_forward_ios
                      </span>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>

          <div className="mt-auto rounded-xl border border-outline-variant bg-surface-container-high p-4">
            <p className="font-body text-[14px] font-semibold text-on-surface">
              Need help?
            </p>
            <p className="mt-1 font-body text-[13px] leading-relaxed text-on-surface-variant">
              Our team is available 24/7 to help you set up your trade account.
            </p>
            <a
              href="mailto:support@bmsprotrade.com"
              className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2 font-body text-[13px] font-semibold text-primary hover:bg-white"
            >
              Contact support
            </a>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="mb-6">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary sm:hidden">
              Step {step} of 3
            </p>
            <h1 className="font-display text-[28px] font-bold leading-[1.15] tracking-tight text-on-surface sm:text-display-lg">
              {copy.title}
            </h1>
            <p className="mt-2 font-body text-body-md text-on-surface-variant sm:text-body-lg">
              {copy.description}
            </p>
          </header>

          <BusinessOnboardingForm
            mode="self_signup"
            endpoint="/api/onboarding/submit"
            submitLabel="Finish & sign in"
            onStepChange={setStep}
          />
        </section>
      </main>
    </div>
  );
}
