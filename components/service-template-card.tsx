"use client";

import type { ServiceTemplateDetail } from "@/lib/onboarding/services/display";
import { iconForServiceSkill } from "@/lib/onboarding/services/types";

const PREVIEW_TASK_COUNT = 3;

type Props = {
  template: ServiceTemplateDetail;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function ServiceTemplateCard({
  template,
  onView,
  onEdit,
  onDelete,
}: Props) {
  const tradeIcon = iconForServiceSkill(template.businessType);
  const previewTasks = template.tasks.slice(0, PREVIEW_TASK_COUNT);
  const hiddenTaskCount = Math.max(0, template.taskCount - PREVIEW_TASK_COUNT);
  const taskProgress = Math.min(template.taskCount, 8);

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-[0_6px_24px_rgba(0,74,198,0.1)] ring-1 ring-outline-variant/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_36px_rgba(0,74,198,0.16)] hover:ring-primary/30 ${
        template.isActive ? "" : "grayscale-[0.25] opacity-90"
      }`}
    >
      {/* Blue hero — creative header without warm accent colors */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-3.5 pb-10 pt-3 text-on-primary">
        <div
          className="pointer-events-none absolute -right-2 -top-1 opacity-[0.12]"
          aria-hidden
        >
          <span className="material-symbols-outlined text-[5.5rem]">
            {tradeIcon}
          </span>
        </div>
        <div
          className="pointer-events-none absolute -left-4 bottom-0 h-20 w-20 rounded-full bg-inverse-primary/25 blur-2xl"
          aria-hidden
        />

        <div className="relative flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 font-body text-[9px] font-bold uppercase tracking-[0.14em] text-white/95 backdrop-blur-sm">
            <span className="material-symbols-outlined text-[13px]">layers</span>
            Template
          </span>

          <div className="flex items-center gap-2">
            {(
              [
                ["visibility", "View template", onView],
                ["edit", "Edit template", onEdit],
                ["delete", "Delete template", onDelete],
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
                <span className="material-symbols-outlined text-[17px]">{icon}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative mt-4 flex items-center gap-2.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-inverse-primary shadow-inner ring-1 ring-white/20">
            <span className="material-symbols-outlined material-symbols-filled text-[24px]">
              {tradeIcon}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="line-clamp-2 font-display text-[1.1rem] font-semibold leading-tight text-white">
              {template.name}
            </h3>
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 font-body text-[10px] font-semibold text-white/90">
              <span className="material-symbols-outlined text-[13px]">handyman</span>
              {template.businessType}
            </p>
          </div>
        </div>
      </div>

      {/* Floating stats */}
      <div className="relative z-10 -mt-6 flex items-stretch gap-2 px-3">
        <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 shadow-md">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke="currentColor"
                className="text-surface-container-high"
                strokeWidth="4"
              />
              <circle
                cx="22"
                cy="22"
                r="18"
                fill="none"
                stroke="currentColor"
                className="text-primary"
                strokeWidth="4"
                strokeDasharray={`${taskProgress * 14.1} 141`}
                strokeLinecap="round"
              />
            </svg>
            <span className="font-display text-[15px] font-bold text-primary">
              {template.taskCount}
            </span>
          </div>
          <div className="min-w-0">
            <p className="font-body text-[12px] font-bold text-on-surface">Tasks</p>
            <p className="truncate font-body text-[10px] text-on-surface-variant">
              Checklist for owners
            </p>
          </div>
        </div>

        <div
          className={`flex flex-col items-center justify-center rounded-xl px-2.5 py-1.5 shadow-md ${
            template.isActive
              ? "bg-gradient-to-b from-primary to-primary-container text-on-primary"
              : "border border-outline-variant bg-surface-container-high text-on-surface-variant"
          }`}
        >
          <span className="material-symbols-outlined material-symbols-filled text-[18px]">
            {template.isActive ? "bolt" : "pause_circle"}
          </span>
          <span className="mt-0.5 font-body text-[9px] font-bold uppercase tracking-wider">
            {template.isActive ? "Live" : "Off"}
          </span>
        </div>
      </div>

      {/* Checklist preview — blue accent panel only */}
      <div className="flex flex-1 flex-col p-3 pt-1.5">
        <div className="rounded-xl border border-primary-fixed/60 bg-gradient-to-br from-primary-fixed/40 via-surface-container-lowest to-surface-container-low p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 font-body text-[10px] font-bold uppercase tracking-[0.12em] text-on-primary-fixed-variant">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-on-primary">
                <span className="material-symbols-outlined text-[15px]">
                  format_list_bulleted
                </span>
              </span>
              Checklist
            </p>
            {template.taskCount > 0 ? (
              <span className="rounded-full bg-primary-fixed px-2 py-0.5 font-body text-[9px] font-bold text-on-primary-fixed-variant">
                {template.taskCount}
              </span>
            ) : null}
          </div>

          {template.tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-primary/25 py-5 text-center font-body text-[11px] text-on-surface-variant">
              No tasks yet — edit to add steps
            </p>
          ) : (
            <ol className="relative space-y-0">
              <div
                className="absolute bottom-1 left-[0.9rem] top-1 w-px bg-gradient-to-b from-primary/50 to-transparent"
                aria-hidden
              />
              {previewTasks.map((task, index) => (
                <li key={task.id} className="relative flex gap-2 py-1">
                  <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container font-body text-[10px] font-bold text-on-primary ring-2 ring-surface-container-lowest">
                    {index + 1}
                  </span>
                  <p className="min-w-0 flex-1 self-center rounded-lg border border-outline-variant/30 bg-surface-container-lowest/90 px-2 py-1.5 font-body text-[11px] font-semibold leading-snug text-on-surface line-clamp-1">
                    {task.title}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <button
            type="button"
            onClick={onView}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-primary via-primary-container to-primary py-2 font-body text-[11px] font-bold text-on-primary shadow-md shadow-primary/20 transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            <span className="material-symbols-outlined text-[17px]">
              {hiddenTaskCount > 0 ? "arrow_forward" : "open_in_new"}
            </span>
            {hiddenTaskCount > 0
              ? `All ${template.taskCount} tasks`
              : "Open template"}
          </button>
        </div>
      </div>
    </article>
  );
}
