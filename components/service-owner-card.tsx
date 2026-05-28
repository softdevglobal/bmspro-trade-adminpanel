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
      className={`mx-auto flex w-full max-w-[18.5rem] flex-col overflow-hidden rounded-2xl shadow-[0_6px_20px_rgba(0,42,150,0.08)] ring-1 ring-outline-variant/40 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,74,198,0.14)] hover:ring-primary/25 ${
        service.isActive ? "" : "opacity-90 saturate-[0.85]"
      }`}
    >
      <div className="relative h-[10.5rem] w-full overflow-hidden">
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

        <div className="absolute inset-x-0 bottom-0 px-3.5 pb-3.5 pt-8">
          <h3 className="line-clamp-2 font-display text-[1.125rem] font-semibold leading-snug text-white">
            {service.name}
          </h3>
          <p className="mt-0.5 line-clamp-1 font-body text-[11px] text-white/85">
            {tradeLabel}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 bg-gradient-to-b from-primary-fixed/40 via-surface-container-low to-surface-container-low px-3.5 py-3.5">
        <div className="flex flex-wrap items-center gap-1.5 font-body text-[11px] font-semibold text-on-surface-variant">
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
          <ul className="min-h-[3.5rem] flex-1 space-y-1.5 rounded-lg border border-primary-fixed/50 bg-surface-container-lowest/75 px-3 py-2.5 backdrop-blur-sm">
            {previewTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-1.5">
                <span className="material-symbols-outlined material-symbols-filled text-[14px] text-primary">
                  check_circle
                </span>
                <span className="line-clamp-1 font-body text-[11px] font-semibold text-on-surface">
                  {task.title}
                </span>
              </li>
            ))}
            {hiddenTaskCount > 0 ? (
              <li className="pl-[1.35rem] font-body text-[11px] font-semibold text-primary">
                +{hiddenTaskCount} more
              </li>
            ) : null}
          </ul>
        ) : (
          <div className="min-h-[3.5rem] flex-1" />
        )}

        <button
          type="button"
          onClick={onView}
          className="inline-flex w-full items-center justify-center gap-0.5 py-1 font-body text-[13px] font-bold text-primary transition-colors hover:text-primary/80"
        >
          View details
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        </button>
      </div>
    </article>
  );
}
