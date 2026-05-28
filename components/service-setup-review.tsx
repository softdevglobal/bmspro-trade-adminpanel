"use client";

import type { WizardTask } from "@/components/service-task-sortable-list";
import { formatServiceDuration } from "@/lib/onboarding/services/display";
import { iconForServiceSkill } from "@/lib/onboarding/services/types";

type ReviewForm = {
  name: string;
  imageUrl: string | null;
  businessType: string;
  requiredSkill: string;
  defaultDurationMin: number;
  isActive: boolean;
  source: "template" | "custom";
  tasks: WizardTask[];
};

type Props = {
  mode: "template" | "service";
  isServiceCreate: boolean;
  form: ReviewForm;
};

function ReviewMetaRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface-container-lowest/80 px-3 py-2.5">
      <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-primary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label}
        </p>
        <p className="mt-0.5 font-body text-[14px] font-semibold text-on-surface">
          {value}
        </p>
      </div>
    </div>
  );
}

export function ServiceSetupReview({ mode, isServiceCreate, form }: Props) {
  const isTemplate = mode === "template";
  const displayName = form.name.trim() || "Untitled service";
  const tradeOrCategory = form.businessType.trim() || "—";
  const skillIcon = iconForServiceSkill(
    isTemplate ? form.businessType : form.requiredSkill,
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary">
          <span className="material-symbols-outlined text-[22px]">fact_check</span>
        </span>
        <div>
          <h3 className="font-display text-headline-sm font-semibold text-on-surface">
            {isTemplate ? "Review your template" : "Review your service"}
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Confirm the details below before saving.
          </p>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
        <div className="flex flex-col gap-4 border-b border-outline-variant/60 bg-surface-container-low p-4 sm:flex-row sm:items-center sm:gap-5">
          {isTemplate ? (
            <span className="mx-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-primary sm:mx-0">
              <span className="material-symbols-outlined material-symbols-filled text-[28px]">
                {skillIcon}
              </span>
            </span>
          ) : (
            <div className="relative mx-auto h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-high sm:mx-0">
              {form.imageUrl ? (
                <img
                  src={form.imageUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[36px] text-outline">
                    {skillIcon}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h4 className="font-display text-headline-sm font-semibold text-on-surface">
              {displayName}
            </h4>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-fixed/50 px-3 py-1 font-body text-[12px] font-semibold text-on-primary-fixed-variant">
                <span className="material-symbols-outlined text-[16px] text-primary">
                  {skillIcon}
                </span>
                {tradeOrCategory}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-body text-[12px] font-semibold ${
                  form.isActive
                    ? "bg-primary-fixed text-on-primary-fixed-variant"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                <span
                  className={`material-symbols-outlined material-symbols-filled text-[14px] ${
                    form.isActive ? "text-primary" : "text-outline"
                  }`}
                >
                  {form.isActive ? "check_circle" : "pause_circle"}
                </span>
                {form.isActive ? "Active" : "Inactive"}
              </span>
            </div>
          </div>
        </div>

        {!isTemplate ? (
          <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
            <ReviewMetaRow
              icon="photo_camera"
              label="Photo"
              value={form.imageUrl ? "Uploaded" : "No photo"}
            />
            <ReviewMetaRow
              icon="schedule"
              label="Default duration"
              value={formatServiceDuration(form.defaultDurationMin)}
            />
            {isServiceCreate ? (
              <ReviewMetaRow
                icon="library_books"
                label="Source"
                value={
                  form.source === "template" ? "From template" : "Custom service"
                }
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-primary">
              checklist
            </span>
            <h4 className="font-body text-[13px] font-bold uppercase tracking-wider text-on-surface">
              Checklist
            </h4>
          </div>
          {form.tasks.length > 0 ? (
            <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 font-body text-[11px] font-semibold text-on-surface-variant">
              {form.tasks.length} {form.tasks.length === 1 ? "task" : "tasks"}
            </span>
          ) : null}
        </div>

        {form.tasks.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-outline-variant bg-surface-container-low/50 px-6 py-10 text-center">
            <span className="material-symbols-outlined text-[40px] text-outline">
              playlist_add
            </span>
            <p className="mt-3 font-body text-[14px] font-semibold text-on-surface">
              No checklist tasks
            </p>
            <p className="mt-1 max-w-xs font-body text-[13px] text-on-surface-variant">
              You can add tasks later by editing this{" "}
              {isTemplate ? "template" : "service"}.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {form.tasks.map((task, index) => {
              const title = task.title.trim() || "Untitled task";
              const description = task.description.trim();

              return (
                <li
                  key={task.clientKey}
                  className="flex gap-3 rounded-xl border border-outline-variant/70 bg-surface-container-lowest p-3.5 shadow-sm"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-body text-[13px] font-bold text-on-primary"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="font-body text-[14px] font-semibold leading-snug text-on-surface">
                      {title}
                    </p>
                    <p
                      className={`mt-1 font-body text-[13px] leading-relaxed ${
                        description
                          ? "text-on-surface-variant"
                          : "italic text-outline"
                      }`}
                    >
                      {description || "No description"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
