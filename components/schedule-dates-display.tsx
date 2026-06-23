"use client";

import {
  TIME_RANGE_LABELS,
  TIME_RANGE_SHORT_LABELS,
  formatSlotDate,
  sortInspectionSlots,
  type InspectionSlot,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import type { ReactNode } from "react";

export type ScheduleCategory = "inspection" | "job";

const CATEGORY_META: Record<
  ScheduleCategory,
  {
    icon: string;
    title: string;
    customerTitle: string;
    adminTitle: string;
    description: string;
    panelClass: string;
    headerClass: string;
    iconWrapClass: string;
    pillClass: string;
    slotBorderClass: string;
    slotBgClass: string;
    accentTextClass: string;
  }
> = {
  inspection: {
    icon: "search",
    title: "Inspection visit",
    customerTitle: "Inspection visit dates",
    adminTitle: "Inspection visit dates",
    description:
      "When the customer wants someone to visit, inspect, and quote the work.",
    panelClass: "border-sky-200/90 bg-sky-50/50",
    headerClass: "text-sky-950",
    iconWrapClass: "bg-sky-100 text-sky-700",
    pillClass: "border-sky-200 bg-sky-50 text-sky-900",
    slotBorderClass: "border-sky-200/90",
    slotBgClass: "bg-white/80",
    accentTextClass: "text-sky-800",
  },
  job: {
    icon: "handyman",
    title: "Job scheduling",
    customerTitle: "Job work dates",
    adminTitle: "Job work dates",
    description:
      "When the actual job should be done after the customer accepts your quotation.",
    panelClass: "border-amber-200/90 bg-amber-50/50",
    headerClass: "text-amber-950",
    iconWrapClass: "bg-amber-100 text-amber-800",
    pillClass: "border-amber-200 bg-amber-50 text-amber-950",
    slotBorderClass: "border-amber-200/90",
    slotBgClass: "bg-white/80",
    accentTextClass: "text-amber-900",
  },
};

function slotTimeIcon(timeRange: InspectionTimeRange): string {
  return timeRange === "morning" ? "wb_twilight" : "wb_sunny";
}

export function scheduleCategoryMeta(category: ScheduleCategory) {
  return CATEGORY_META[category];
}

export function ScheduleCategoryPanel({
  category,
  audience = "admin",
  children,
  className = "",
}: {
  category: ScheduleCategory;
  audience?: "admin" | "customer";
  children: ReactNode;
  className?: string;
}) {
  const meta = CATEGORY_META[category];
  const title =
    audience === "customer" ? meta.customerTitle : meta.adminTitle;

  return (
    <section
      className={`rounded-xl border p-3 sm:p-4 ${meta.panelClass} ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.iconWrapClass}`}
        >
          <span className="material-symbols-outlined text-[22px]">
            {meta.icon}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`font-display text-[14px] font-semibold leading-snug ${meta.headerClass}`}
          >
            {title}
          </p>
          <p className="mt-0.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
            {meta.description}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function ScheduleSubsection({
  category,
  label,
  hint,
  children,
}: {
  category: ScheduleCategory;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const meta = CATEGORY_META[category];
  return (
    <div>
      <p
        className={`font-body text-[11px] font-bold uppercase tracking-wider ${meta.accentTextClass}`}
      >
        {label}
      </p>
      {hint ? (
        <p className="mt-0.5 font-body text-[11px] leading-relaxed text-on-surface-variant">
          {hint}
        </p>
      ) : null}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export type ScheduleSlotVariant = "default" | "proposed" | "scheduled" | "confirmed";

export function ScheduleSlotsList({
  slots,
  category,
  variant = "default",
  timeZone,
  timeWindow = null,
  emptyLabel = "—",
}: {
  slots: InspectionSlot[];
  category: ScheduleCategory;
  variant?: ScheduleSlotVariant;
  timeZone?: string | null;
  timeWindow?: string | null;
  emptyLabel?: string;
}) {
  const meta = CATEGORY_META[category];

  if (slots.length === 0) {
    return (
      <p className="font-body text-[13px] text-on-surface-variant">{emptyLabel}</p>
    );
  }

  const orderedSlots = sortInspectionSlots(slots);

  const variantClass =
    variant === "proposed"
      ? "border-violet-200/90 bg-violet-50/70"
      : variant === "scheduled" || variant === "confirmed"
        ? "border-emerald-200/90 bg-emerald-50/70"
        : `${meta.slotBorderClass} ${meta.slotBgClass}`;

  const timeClass =
    variant === "proposed"
      ? "text-violet-900"
      : variant === "scheduled" || variant === "confirmed"
        ? "text-emerald-900"
        : meta.accentTextClass;

  return (
    <ul className="space-y-1.5">
      {orderedSlots.map((slot, index) => (
        <li
          key={`${slot.date}-${slot.timeRange}-${index}`}
          className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 shadow-sm ${variantClass}`}
        >
          {orderedSlots.length > 1 ? (
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-body text-[11px] font-bold ${meta.iconWrapClass}`}
              aria-hidden
            >
              {index + 1}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-body text-[13px] font-semibold leading-snug text-on-surface">
              <span className="material-symbols-outlined text-[17px] text-primary">
                event
              </span>
              {formatSlotDate(slot.date, timeZone)}
            </p>
            <p
              className={`mt-1 flex items-center gap-1.5 font-body text-[12px] leading-snug ${timeClass}`}
            >
              <span className="material-symbols-outlined text-[16px] opacity-85">
                {slotTimeIcon(slot.timeRange)}
              </span>
              {TIME_RANGE_LABELS[slot.timeRange]}
            </p>
            {variant === "scheduled" && timeWindow ? (
              <p className="mt-1 flex items-center gap-1.5 font-body text-[12px] font-semibold leading-snug text-emerald-900">
                <span className="material-symbols-outlined text-[16px] text-emerald-700">
                  schedule
                </span>
                {timeWindow}
              </p>
            ) : variant === "scheduled" && !timeWindow ? (
              <p className="mt-1 flex items-center gap-1.5 font-body text-[12px] font-medium leading-snug text-amber-800/90">
                <span className="material-symbols-outlined text-[16px] text-amber-700">
                  schedule
                </span>
                Exact time to be added
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ScheduleDatePill({
  category,
  slot,
  timeZone,
  prefix,
}: {
  category: ScheduleCategory;
  slot: InspectionSlot;
  timeZone?: string | null;
  prefix?: string;
}) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 font-body text-[10px] font-semibold sm:px-2.5 sm:text-[11px] ${meta.pillClass}`}
    >
      <span className="material-symbols-outlined shrink-0 text-[12px] leading-none">
        {meta.icon}
      </span>
      {prefix ? (
        <span className="shrink-0 font-bold uppercase tracking-wide opacity-80">
          {prefix}
        </span>
      ) : null}
      <span className="truncate">
        {formatSlotDate(slot.date, timeZone)} ·{" "}
        {TIME_RANGE_SHORT_LABELS[slot.timeRange]}
      </span>
    </span>
  );
}
