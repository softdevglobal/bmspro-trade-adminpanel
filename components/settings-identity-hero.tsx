"use client";

import { BusinessLogoUploader } from "@/components/business-logo-settings";
import type { BusinessProfilePlan } from "@/lib/onboarding/server";
import { timezoneLabel } from "@/lib/onboarding/tenant-display";

type SettingsIdentityHeroProps = {
  businessName: string;
  businessEmail: string;
  abn: string;
  businessPhone: string;
  businessAddress: string;
  state: string | null;
  timezone: string | null;
  plan: BusinessProfilePlan | null;
  loading?: boolean;
};

function formatPlanLabel(plan: BusinessProfilePlan): string {
  const period = plan.period ? `/${plan.period}` : "";
  const name = plan.name.replace(/^Booking Management$/i, "Job Management");
  return `${name} · AU$${plan.price}${period}`;
}

function MetaChip({
  icon,
  label,
  value,
  multiline,
}: {
  icon: string;
  label: string;
  value: string;
  multiline?: boolean;
}) {
  if (!value || value === "—") return null;

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-low/80 px-3 py-2">
      <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-on-surface-variant">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label}
        </p>
        <p
          className={`font-body text-[12px] font-medium text-on-surface ${multiline ? "leading-snug" : "truncate"}`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

export function SettingsIdentityHero({
  businessName,
  businessEmail,
  abn,
  businessPhone,
  businessAddress,
  state,
  timezone,
  plan,
  loading,
}: SettingsIdentityHeroProps) {
  const displayName = businessName.trim() || "Your business";

  if (loading) {
    return (
      <div className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-sm">
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading your business profile…
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant/80 bg-gradient-to-br from-surface-container-lowest via-surface-container-low to-primary-fixed/30 shadow-sm">
      <div className="flex flex-col gap-5 p-4 sm:gap-6 sm:p-6 lg:flex-row lg:items-center lg:gap-8">
        <div className="mx-auto shrink-0 sm:mx-0 lg:w-[168px]">
          <BusinessLogoUploader compact />
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="inline-flex rounded-full bg-on-surface px-2.5 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide text-surface-container-lowest">
              Business owner
            </span>
            {plan ? (
              <span className="inline-flex rounded-full bg-tertiary-container/60 px-2.5 py-0.5 font-body text-[10px] font-semibold text-tertiary">
                {formatPlanLabel(plan)}
              </span>
            ) : null}
          </div>

          <h2 className="mt-2 font-display text-[22px] font-bold tracking-tight text-on-surface sm:text-[24px]">
            {displayName}
          </h2>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            {businessEmail || "—"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 border-t border-outline-variant/50 bg-surface-container-lowest/60 px-4 py-3.5 sm:grid-cols-2 sm:px-6 sm:py-4 lg:grid-cols-3 xl:grid-cols-5">
        <MetaChip icon="numbers" label="ABN" value={abn.trim() || "—"} />
        <MetaChip icon="call" label="Phone" value={businessPhone.trim() || "—"} />
        <MetaChip
          icon="schedule"
          label="Time zone"
          value={timezone ? timezoneLabel(timezone) : "—"}
        />
        <MetaChip icon="map" label="State" value={state?.trim() || "—"} />
        <MetaChip
          icon="location_on"
          label="Address"
          value={businessAddress.trim() || "—"}
          multiline
        />
      </div>
    </div>
  );
}
