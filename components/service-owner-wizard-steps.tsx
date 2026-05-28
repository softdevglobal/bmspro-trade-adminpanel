"use client";

import {
  ServiceTaskSortableList,
  type WizardTask,
} from "@/components/service-task-sortable-list";
import type { ServiceTemplateDetail } from "@/lib/onboarding/services/display";
import { formatServiceDuration } from "@/lib/onboarding/services/display";
import { iconForServiceSkill } from "@/lib/onboarding/services/types";
import { useState } from "react";

const INPUT_CLASS =
  "w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15";

/** Number fields without browser stepper arrows. */
const NUMBER_INPUT_CLASS = `${INPUT_CLASS} w-20 text-center [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const DURATION_PRESETS = [30, 60, 90, 120, 180, 240, 480] as const;
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 24 * 60;

function clampDurationMinutes(minutes: number): number {
  if (minutes < MIN_DURATION_MIN) return MIN_DURATION_MIN;
  if (minutes > MAX_DURATION_MIN) return MAX_DURATION_MIN;
  return Math.round(minutes);
}

type ServiceSource = "template" | "custom";

function WizardSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest shadow-sm">
      <div className="flex items-start gap-3 border-b border-outline-variant/50 bg-gradient-to-r from-primary-fixed/50 via-surface-container-low to-surface-container-lowest px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
          <span className="material-symbols-outlined text-[20px]">{icon}</span>
        </span>
        <div className="min-w-0">
          <h4 className="font-display text-[15px] font-semibold text-on-surface">
            {title}
          </h4>
          {subtitle ? (
            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FieldLabel({
  label,
  required,
  optional,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <span className="mb-2 block font-body text-[12px] font-semibold tracking-wide text-on-surface-variant">
      {label}
      {required ? <span className="text-error"> *</span> : null}
      {optional ? (
        <span className="font-normal text-outline"> (optional)</span>
      ) : null}
    </span>
  );
}

type SourceStepProps = {
  source: ServiceSource;
  templateId: string | null;
  templates: ServiceTemplateDetail[];
  ownerBusinessType: string | null;
  onSourceChange: (source: ServiceSource) => void;
  onTemplateSelect: (templateId: string) => void;
};

function TemplateChecklistPreview({
  template,
}: {
  template: ServiceTemplateDetail;
}) {
  return (
    <div className="mt-4 rounded-xl border border-primary/20 bg-primary-fixed/25 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-body text-[12px] font-bold uppercase tracking-wide text-on-primary-fixed-variant">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-on-primary">
            <span className="material-symbols-outlined text-[16px]">
              checklist
            </span>
          </span>
          Checklist preview
        </p>
        <span className="rounded-full bg-primary-fixed px-2.5 py-0.5 font-body text-[10px] font-bold text-on-primary-fixed-variant">
          {template.taskCount} {template.taskCount === 1 ? "task" : "tasks"}
        </span>
      </div>

      {template.tasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-primary/25 bg-surface-container-lowest/80 px-4 py-5 text-center font-body text-[12px] text-on-surface-variant">
          This template has no tasks yet. You can add tasks in a later step.
        </p>
      ) : (
        <ol className="relative flex flex-col gap-0">
          <div
            className="absolute bottom-2 left-[0.85rem] top-2 w-px bg-gradient-to-b from-primary/40 to-transparent"
            aria-hidden
          />
          {template.tasks.map((task, index) => (
            <li key={task.id} className="relative flex gap-2.5 py-1.5">
              <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-container font-body text-[10px] font-bold text-on-primary ring-2 ring-primary-fixed/50">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2">
                <p className="font-body text-[13px] font-semibold leading-snug text-on-surface">
                  {task.title}
                </p>
                {task.description.trim() ? (
                  <p className="mt-0.5 line-clamp-2 font-body text-[11px] leading-relaxed text-on-surface-variant">
                    {task.description}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-3 font-body text-[11px] text-on-surface-variant">
        You can edit these tasks after continuing — name, photo, and duration are
        set in the next step.
      </p>
    </div>
  );
}

/** Step 1 — pick template or custom service (business owner create flow). */
export function ServiceOwnerSourceStep({
  source,
  templateId,
  templates,
  ownerBusinessType,
  onSourceChange,
  onTemplateSelect,
}: SourceStepProps) {
  const selectedTemplate =
    templateId !== null
      ? templates.find((template) => template.id === templateId) ?? null
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-4 py-5 text-on-primary">
        <div
          className="pointer-events-none absolute -right-4 top-0 opacity-[0.1]"
          aria-hidden
        >
          <span className="material-symbols-outlined text-[6rem]">
            home_repair_service
          </span>
        </div>
        <p className="relative font-body text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
          Step 1 · Get started
        </p>
        <h3 className="relative mt-1 font-display text-[1.35rem] font-semibold leading-tight text-white">
          How do you want to build this service?
        </h3>
        <p className="relative mt-2 max-w-md font-body text-[13px] text-white/85">
          Start from a platform template or define a custom service with your own
          checklist, photo, and booking time.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(
          [
            {
              id: "template" as const,
              label: "From template",
              description: "Super Admin blueprint — customize name, time & photo.",
              icon: "library_books",
            },
            {
              id: "custom" as const,
              label: "Custom service",
              description: "Full control: photo, duration, tasks from scratch.",
              icon: "edit_note",
            },
          ] as const
        ).map((option) => {
          const isActive = source === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSourceChange(option.id)}
              className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
                isActive
                  ? "border-2 border-primary bg-primary-fixed/35 shadow-md shadow-primary/10 ring-2 ring-primary/15"
                  : "border-outline-variant bg-surface-container-lowest hover:border-primary/30 hover:shadow-md"
              }`}
            >
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                  isActive
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-outline group-hover:bg-primary-fixed group-hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[24px]">
                  {option.icon}
                </span>
              </span>
              <p className="mt-3 font-body text-[15px] font-semibold text-on-surface">
                {option.label}
              </p>
              <p className="mt-1 font-body text-[12px] leading-relaxed text-on-surface-variant">
                {option.description}
              </p>
              {isActive ? (
                <span className="material-symbols-outlined material-symbols-filled absolute right-3 top-3 text-[22px] text-primary">
                  check_circle
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {source === "template" ? (
        <WizardSection
          icon="layers"
          title="Pick a template"
          subtitle={
            ownerBusinessType
              ? `Showing ${ownerBusinessType} templates only`
              : "Choose a starting checklist for your team"
          }
        >
          {templates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-primary/25 bg-primary-fixed/20 px-4 py-6 text-center font-body text-[13px] text-on-surface-variant">
              No templates available yet. Switch to custom service or ask your
              Super Admin to publish templates for your trade.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {templates.map((template) => {
                  const isActive = templateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => onTemplateSelect(template.id)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                        isActive
                          ? "border-2 border-primary bg-primary-fixed/40 shadow-sm"
                          : "border-outline-variant/80 bg-surface-container-low hover:border-primary/25"
                      }`}
                    >
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                          isActive
                            ? "bg-primary text-on-primary"
                            : "bg-primary-fixed text-primary"
                        }`}
                      >
                        <span className="material-symbols-outlined material-symbols-filled text-[22px]">
                          {iconForServiceSkill(template.businessType)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-[14px] font-semibold text-on-surface">
                          {template.name}
                        </p>
                        <p className="mt-0.5 font-body text-[11px] text-on-surface-variant">
                          {template.businessType} · {template.taskCount}{" "}
                          {template.taskCount === 1 ? "task" : "tasks"}
                        </p>
                      </div>
                      {isActive ? (
                        <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[20px] text-primary">
                          radio_button_checked
                        </span>
                      ) : (
                        <span className="material-symbols-outlined shrink-0 text-[20px] text-outline">
                          radio_button_unchecked
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedTemplate ? (
                <TemplateChecklistPreview template={selectedTemplate} />
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-outline-variant/80 bg-surface-container-low/50 px-4 py-3 text-center font-body text-[12px] text-on-surface-variant">
                  Select a template above to preview its checklist tasks.
                </p>
              )}
            </>
          )}
        </WizardSection>
      ) : null}
    </div>
  );
}

type DetailsForm = {
  name: string;
  defaultDurationMin: number;
  imageUrl: string | null;
};

type DetailsStepProps = {
  form: DetailsForm;
  onChange: (patch: Partial<DetailsForm>) => void;
  onUploadImage: (
    file: File,
  ) => Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }>;
  onError: (message: string) => void;
};

/** Step 2 — photo, name, duration, and service settings. */
export function ServiceOwnerDetailsStep({
  form,
  onChange,
  onUploadImage,
  onError,
}: DetailsStepProps) {
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    onError("");
    const result = await onUploadImage(file);
    setIsUploading(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }
    onChange({ imageUrl: result.imageUrl });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-4 py-4 text-on-primary">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
          Step 2 · Service profile
        </p>
        <h3 className="mt-1 font-display text-[1.25rem] font-semibold text-white">
          Photo, timing &amp; booking details
        </h3>
        <p className="mt-1.5 font-body text-[12px] text-white/85">
          These settings appear on your catalog and help staff schedule jobs.
        </p>
      </div>

      <WizardSection
        icon="photo_camera"
        title="Service photo"
        subtitle="Shown to customers and staff in your service list"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative mx-auto h-32 w-32 shrink-0 overflow-hidden rounded-2xl border-2 border-dashed border-primary/30 bg-gradient-to-br from-primary-fixed/40 to-surface-container-low shadow-inner sm:mx-0">
            {form.imageUrl ? (
              <img
                src={form.imageUrl}
                alt="Service"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-primary">
                <span className="material-symbols-outlined text-[40px]">add_a_photo</span>
                <span className="font-body text-[10px] font-semibold uppercase tracking-wide">
                  No photo
                </span>
              </div>
            )}
            {isUploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-on-background/40 backdrop-blur-[2px]">
                <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
                  progress_activity
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-container px-4 py-3 font-body text-[13px] font-bold text-on-primary shadow-md shadow-primary/20 transition-transform hover:scale-[1.01] active:scale-[0.99]">
              <span className="material-symbols-outlined text-[20px]">upload</span>
              {isUploading ? "Uploading…" : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={isUploading}
                onChange={(event) => void handleFileChange(event)}
              />
            </label>
            {form.imageUrl ? (
              <button
                type="button"
                onClick={() => onChange({ imageUrl: null })}
                className="rounded-xl border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-error"
              >
                Remove photo
              </button>
            ) : null}
            <p className="font-body text-[11px] text-on-surface-variant">
              JPEG, PNG, WebP or GIF · max 5 MB
            </p>
          </div>
        </div>
      </WizardSection>

      <WizardSection
        icon="badge"
        title="Service name"
        subtitle="How this service appears in your catalog"
      >
        <label className="block">
          <FieldLabel label="Service name" required />
          <input
            type="text"
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="e.g. Emergency pipe repair"
            className={INPUT_CLASS}
          />
        </label>
      </WizardSection>

      <WizardSection
        icon="schedule"
        title="Default job duration"
        subtitle="How long bookings usually take — staff can adjust per job"
      >
        <div className="flex flex-wrap gap-2">
          {DURATION_PRESETS.map((minutes) => {
            const isActive = form.defaultDurationMin === minutes;
            return (
              <button
                key={minutes}
                type="button"
                onClick={() => onChange({ defaultDurationMin: minutes })}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-body text-[12px] font-semibold transition-all ${
                  isActive
                    ? "bg-primary text-on-primary shadow-md shadow-primary/20"
                    : "border border-outline-variant bg-surface-container-low text-on-surface hover:border-primary/30"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">timer</span>
                {formatServiceDuration(minutes)}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-primary/15 bg-primary-fixed/20 p-3.5">
          <p className="mb-2.5 flex items-center gap-2 font-body text-[12px] font-bold text-on-primary-fixed-variant">
            <span className="material-symbols-outlined text-[18px] text-primary">
              edit_calendar
            </span>
            Custom time
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-body text-[11px] font-semibold text-on-surface-variant">
                Hours
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={23}
                value={Math.floor(form.defaultDurationMin / 60)}
                onChange={(event) => {
                  const hours = Math.max(
                    0,
                    Math.min(23, Number(event.target.value) || 0),
                  );
                  const mins = form.defaultDurationMin % 60;
                  onChange({
                    defaultDurationMin: clampDurationMinutes(hours * 60 + mins),
                  });
                }}
                className={NUMBER_INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-body text-[11px] font-semibold text-on-surface-variant">
                Minutes
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                step={5}
                value={form.defaultDurationMin % 60}
                onChange={(event) => {
                  const mins = Math.max(
                    0,
                    Math.min(59, Number(event.target.value) || 0),
                  );
                  const hours = Math.floor(form.defaultDurationMin / 60);
                  onChange({
                    defaultDurationMin: clampDurationMinutes(hours * 60 + mins),
                  });
                }}
                className={NUMBER_INPUT_CLASS}
              />
            </label>
            <p className="pb-2.5 font-body text-[14px] font-bold text-primary">
              = {formatServiceDuration(form.defaultDurationMin)}
            </p>
          </div>
          <p className="mt-2 font-body text-[11px] text-on-surface-variant">
            Minimum 15 minutes. Presets above still apply — use custom for any other
            length.
          </p>
        </div>
      </WizardSection>
    </div>
  );
}

type LiveToggleProps = {
  isActive: boolean;
  onChange: (isActive: boolean) => void;
};

/** Catalog visibility — shown last on the details step (after checklist). */
export function ServiceOwnerLiveToggle({ isActive, onChange }: LiveToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!isActive)}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all ${
        isActive
          ? "border-2 border-primary bg-primary-fixed/35 shadow-sm"
          : "border-outline-variant bg-surface-container-lowest hover:border-primary/20"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          isActive ? "bg-primary text-on-primary" : "bg-surface-container-high text-outline"
        }`}
      >
        <span className="material-symbols-outlined material-symbols-filled text-[22px]">
          {isActive ? "bolt" : "pause_circle"}
        </span>
      </span>
      <div>
        <p className="font-body text-[13px] font-semibold text-on-surface">
          {isActive ? "Live in catalog" : "Paused"}
        </p>
        <p className="mt-0.5 font-body text-[11px] text-on-surface-variant">
          {isActive
            ? "Customers and staff can book this service"
            : "Hidden until you turn it back on"}
        </p>
      </div>
    </button>
  );
}

type ChecklistSectionProps = {
  tasks: WizardTask[];
  onAddTask: () => void;
  onUpdateTask: (
    index: number,
    patch: Partial<Pick<WizardTask, "title" | "description">>,
  ) => void;
  onRemoveTask: (index: number) => void;
  onReorderTasks: (fromIndex: number, toIndex: number) => void;
};

/** Checklist tasks on the same step as service details (business owner flow). */
export function ServiceOwnerChecklistSection({
  tasks,
  onAddTask,
  onUpdateTask,
  onRemoveTask,
  onReorderTasks,
}: ChecklistSectionProps) {
  return (
    <WizardSection
      icon="checklist"
      title="Checklist tasks"
      subtitle="Steps your team completes on site — drag to reorder"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-body text-[12px] text-on-surface-variant">
          {tasks.length === 0
            ? "Optional, but helps staff follow the same process every job."
            : `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`}
        </p>
        <button
          type="button"
          onClick={onAddTask}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 font-body text-[12px] font-semibold text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.99]"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add task
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant/80 bg-surface-container-low/40 px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
          No tasks yet. Add tasks here or start from a template on the previous step.
        </p>
      ) : (
        <ServiceTaskSortableList
          tasks={tasks}
          onReorder={onReorderTasks}
          onUpdate={onUpdateTask}
          onRemove={onRemoveTask}
        />
      )}
    </WizardSection>
  );
}
