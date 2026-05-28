"use client";

import {
  formatServiceDuration,
  type BusinessServiceDetail,
} from "@/lib/onboarding/services/display";
import { iconForServiceSkill } from "@/lib/onboarding/services/types";

const PREVIEW_TASK_COUNT = 2;

type Props = {
  service: BusinessServiceDetail;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function ServiceOwnerCard({
  service,
  onView,
  onEdit,
  onDelete,
}: Props) {
  const skillIcon = iconForServiceSkill(service.requiredSkill);
  const previewTasks = service.tasks.slice(0, PREVIEW_TASK_COUNT);
  const hiddenTaskCount = Math.max(0, service.taskCount - PREVIEW_TASK_COUNT);
  const durationLabel = formatServiceDuration(service.defaultDurationMin);
  const tradeLabel = service.businessType || service.requiredSkill;

  return (
    <article
      className={`flex w-full max-w-none flex-col overflow-hidden rounded-2xl shadow-[0_6px_20px_rgba(0,42,150,0.08)] ring-1 ring-outline-variant/40 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,74,198,0.14)] hover:ring-primary/25 sm:mx-auto sm:max-w-[18.5rem] ${
        service.isActive ? "" : "opacity-90 saturate-[0.85]"
      }`}
    >
      <div className="relative h-[12.5rem] w-full overflow-hidden sm:h-[10.5rem]">
        {service.imageUrl ? (
          <img
            src={service.imageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#00174b] via-primary-container to-primary">
            <span className="material-symbols-outlined text-[36px] text-white/85">
              {skillIcon}
            </span>
          </div>
        )}

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,23,75,0.15)_0%,transparent_40%,rgba(0,23,75,0.8)_100%)]"
        />

        <span
          className={`absolute left-2 top-2 inline-flex items-center gap-1 font-body text-[9px] font-bold uppercase tracking-wider text-white/95 ${
            service.isActive ? "" : "text-white/75"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {service.isActive ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
            ) : null}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                service.isActive ? "bg-white" : "bg-white/60"
              }`}
            />
          </span>
          {service.isActive ? "Live" : "Paused"}
        </span>

        <div className="absolute right-2 top-2 flex gap-0.5">
          <button
            type="button"
            title="Edit service"
            onClick={onEdit}
            className="flex h-8 w-8 items-center justify-center text-white/90 transition-colors hover:text-white"
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button
            type="button"
            title="Delete service"
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center text-white/80 transition-colors hover:text-error-container"
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>

        <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-9 sm:px-3.5 sm:pb-3.5 sm:pt-8">
          <h3 className="line-clamp-2 font-display text-[1.25rem] font-semibold leading-snug text-white sm:text-[1.125rem]">
            {service.name}
          </h3>
          <p className="mt-0.5 line-clamp-1 font-body text-[12px] text-white/85 sm:text-[11px]">
            {tradeLabel}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 bg-gradient-to-b from-primary-fixed/40 via-surface-container-low to-surface-container-low px-4 py-4 sm:gap-3 sm:px-3.5 sm:py-3.5">
        <div className="flex flex-wrap items-center gap-2 font-body text-[12px] font-semibold text-on-surface-variant sm:gap-1.5 sm:text-[11px]">
          <span className="inline-flex items-center gap-0.5 text-on-surface">
            <span className="material-symbols-outlined text-[13px] text-primary">
              schedule
            </span>
            {durationLabel}
          </span>
          <span aria-hidden className="text-outline-variant">
            ·
          </span>
          <span className="inline-flex items-center gap-0.5 text-on-surface">
            <span className="material-symbols-outlined text-[13px] text-primary">
              checklist
            </span>
            {service.taskCount} {service.taskCount === 1 ? "task" : "tasks"}
          </span>
        </div>

        {service.tasks.length > 0 ? (
          <ul className="min-h-[4rem] flex-1 space-y-2 rounded-lg border border-primary-fixed/50 bg-surface-container-lowest/75 px-3.5 py-3 backdrop-blur-sm sm:min-h-[3.5rem] sm:space-y-1.5 sm:px-3 sm:py-2.5">
            {previewTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 sm:gap-1.5">
                <span className="material-symbols-outlined material-symbols-filled text-[16px] text-primary sm:text-[14px]">
                  check_circle
                </span>
                <span className="line-clamp-1 font-body text-[12px] font-semibold text-on-surface sm:text-[11px]">
                  {task.title}
                </span>
              </li>
            ))}
            {hiddenTaskCount > 0 ? (
              <li className="pl-[1.5rem] font-body text-[12px] font-semibold text-primary sm:pl-[1.35rem] sm:text-[11px]">
                +{hiddenTaskCount} more
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="min-h-[4rem] flex-1 sm:min-h-[3.5rem]" />
        )}

        <button
          type="button"
          onClick={onView}
          className="inline-flex w-full items-center justify-center gap-0.5 py-2 font-body text-[14px] font-bold text-primary transition-colors hover:text-primary/80 sm:py-1 sm:text-[13px]"
        >
          View details
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </div>
    </article>
  );
}
