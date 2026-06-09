"use client";

import type { BusinessProfilePlan } from "@/lib/onboarding/server";
import type { ReactNode } from "react";
import { timezoneLabel } from "@/lib/onboarding/tenant-display";

type SummaryData = {
  businessName: string;
  businessEmail: string;
  logoUrl: string | null;
  abn: string;
  businessPhone: string;
  businessAddress: string;
  businessType: string | null;
  state: string | null;
  timezone: string | null;
  plan: BusinessProfilePlan | null;
};

function formatPlanLabel(plan: BusinessProfilePlan): string {
  const period = plan.period ? `/${plan.period}` : "";
  return `${plan.name} (AU$${plan.price}${period})`;
}

function SummaryRow({
  icon,
  label,
  children,
  stacked,
}: {
  icon: string;
  label: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className="border-b border-outline-variant/60 py-3 last:border-b-0">
      <div className={`flex gap-3 ${stacked ? "flex-col" : "items-center"}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="material-symbols-outlined shrink-0 text-[18px] text-on-surface-variant">
            {icon}
          </span>
          <span className="font-body text-[13px] text-on-surface-variant">
            {label}
          </span>
        </div>
        <div
          className={
            stacked
              ? "pl-[30px] font-body text-[13px] font-medium text-on-surface"
              : "shrink-0 font-body text-[13px] font-medium text-on-surface"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function BusinessProfileSummaryCard({
  data,
  loading,
}: {
  data: SummaryData;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading profile…
        </p>
      </div>
    );
  }

  const displayName = data.businessName.trim() || "Your business";

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-start gap-3 border-b border-outline-variant/60 pb-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-outline-variant/60 bg-white">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.logoUrl}
              alt={displayName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="material-symbols-outlined text-[28px] text-primary">
              store
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h4 className="truncate font-display text-[15px] font-bold uppercase tracking-wide text-on-surface">
            {displayName}
          </h4>
          <p className="mt-0.5 truncate font-body text-[12px] text-on-surface-variant">
            {data.businessEmail || "—"}
          </p>
        </div>
      </div>

      <div className="pt-1">
        <SummaryRow icon="badge" label="Role">
          <span className="inline-flex rounded-full bg-on-surface px-2.5 py-0.5 font-body text-[11px] font-semibold text-surface-container-lowest">
            Business owner
          </span>
        </SummaryRow>

        <SummaryRow icon="numbers" label="ABN">
          {data.abn.trim() || "—"}
        </SummaryRow>

        <SummaryRow icon="call" label="Phone">
          {data.businessPhone.trim() || "—"}
        </SummaryRow>

        <SummaryRow icon="location_on" label="Address" stacked>
          {data.businessAddress.trim() || "—"}
        </SummaryRow>

        <SummaryRow icon="schedule" label="Time zone">
          {timezoneLabel(data.timezone)}
        </SummaryRow>

        <SummaryRow icon="map" label="State">
          {data.state?.trim() || "—"}
        </SummaryRow>

        <SummaryRow icon="workspace_premium" label="Plan">
          {data.plan ? (
            <span className="inline-flex rounded-full bg-tertiary-container/50 px-2.5 py-0.5 font-body text-[11px] font-semibold text-tertiary">
              {formatPlanLabel(data.plan)}
            </span>
          ) : (
            "—"
          )}
        </SummaryRow>
      </div>
    </div>
  );
}
