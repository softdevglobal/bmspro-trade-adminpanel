/**
 * Dashboard Services page.
 *
 * Role-specific UI:
 * - Super Admin — manage global service templates (create/edit/delete wizard)
 * - Business Owner — manage tenant services from templates or custom setup
 *
 * Includes multi-step setup wizards, image upload, filtering, and stats cards.
 */

"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { useAuth } from "@/lib/auth/auth-context";
import { auth } from "@/lib/firebase/client";
import {
  formatServiceDuration,
  type BusinessServiceDetail,
  type ServiceTemplateDetail,
} from "@/lib/onboarding/services/display";
import {
  BUSINESS_TYPES,
  type BusinessType,
} from "@/lib/onboarding/types";
import {
  SERVICE_SKILLS,
  iconForServiceSkill,
  type ServiceTaskInput,
} from "@/lib/onboarding/services/types";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ServiceFilter = "all" | "active" | "inactive";
type SetupMode = "service" | "template";
type ServiceSource = "template" | "custom";
type SetupStep = 1 | 2 | 3 | 4;

type SetupForm = {
  source: ServiceSource;
  templateId: string | null;
  name: string;
  businessType: BusinessType;
  category: string;
  requiredSkill: string;
  defaultDurationMin: number;
  needsReview: boolean;
  isActive: boolean;
  imageUrl: string | null;
  tasks: ServiceTaskInput[];
};

const INITIAL_SETUP_FORM: SetupForm = {
  source: "template",
  templateId: null,
  name: "",
  businessType: "Plumbing",
  category: "",
  requiredSkill: "Plumbing",
  defaultDurationMin: 60,
  needsReview: false,
  isActive: true,
  imageUrl: null,
  tasks: [],
};

const DURATION_PRESETS = [30, 60, 90, 120, 180, 240, 480] as const;

const EMPTY_TASK: ServiceTaskInput = {
  title: "",
  description: "",
  isRequired: true,
  photoRequired: false,
  customerVisible: true,
};

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

/** Parses fetch response body safely; handles empty or non-JSON server responses. */
async function readJsonResponse<T extends { ok?: boolean; error?: string }>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return { ok: false, error: "Empty response from server." } as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return { ok: false, error: "Invalid response from server." } as T;
  }
}

/** Authenticated JSON fetch using the current Firebase user's ID token. */
async function authFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { ok: false, error: "Please sign in again." };

    const token = await user.getIdToken();
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });

    const data = await readJsonResponse<T & { ok?: boolean; error?: string }>(
      response,
    );

    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        error:
          typeof data.error === "string" ? data.error : "Request failed.",
      };
    }

    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}

/** Uploads an image file to /api/uploads/service-image for templates or services. */
async function uploadServiceImageFile(
  file: File,
  scope: "service-templates" | "services",
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Please sign in again." };

  const token = await user.getIdToken();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("scope", scope);

  const response = await fetch("/api/uploads/service-image", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await readJsonResponse<{
    ok?: boolean;
    error?: string;
    imageUrl?: string;
  }>(response);

  if (!response.ok || !data.ok || !data.imageUrl) {
    return {
      ok: false,
      error: data.error ?? "Could not upload image.",
    };
  }

  return { ok: true, imageUrl: data.imageUrl };
}

/** Renders a service thumbnail image or a skill-based fallback icon. */
function ServiceThumb({
  imageUrl,
  skill,
  alt,
}: {
  imageUrl: string | null;
  skill: string;
  alt: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className="h-10 w-10 shrink-0 rounded-lg border border-outline-variant object-cover"
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
      <span className="material-symbols-outlined material-symbols-filled text-[20px]">
        {iconForServiceSkill(skill)}
      </span>
    </div>
  );
}

/** Image picker with preview, upload progress, and remove for the setup wizard. */
function ServiceImageField({
  imageUrl,
  scope,
  onChange,
  onError,
}: {
  imageUrl: string | null;
  scope: "service-templates" | "services";
  onChange: (imageUrl: string | null) => void;
  onError: (message: string) => void;
}) {
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    onError("");
    const result = await uploadServiceImageFile(file, scope);
    setIsUploading(false);

    if (!result.ok) {
      onError(result.error);
      return;
    }

    onChange(result.imageUrl);
  }

  return (
    <Field label="Service image" optional>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-outline-variant bg-surface-container-low">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Service preview"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="material-symbols-outlined text-[32px] text-outline">
              image
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low">
            <span className="material-symbols-outlined text-[18px]">
              upload
            </span>
            {isUploading ? "Uploading..." : "Upload image"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => void handleFileChange(event)}
            />
          </label>

          {imageUrl && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-error"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="font-body text-[12px] text-on-surface-variant">
        JPEG, PNG, WebP or GIF. Max 5 MB.
      </p>
    </Field>
  );
}

/** Toggle chip for filtering services/templates by active status. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex h-9 items-center gap-2 rounded-full bg-primary px-3 font-body text-[13px] font-semibold text-on-primary"
          : "flex h-9 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
      }
    >
      {label}
      <span
        className={
          active
            ? "rounded-full bg-on-primary/20 px-1.5 py-0.5 text-[11px]"
            : "rounded-full bg-surface-variant px-1.5 py-0.5 text-[11px] text-on-surface-variant"
        }
      >
        {count}
      </span>
    </button>
  );
}

/** Labeled form field wrapper with required/optional indicators. */
function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
        {optional && (
          <span className="font-normal text-outline"> (optional)</span>
        )}
      </span>
      {children}
    </label>
  );
}

type EditTarget =
  | { type: "template"; record: ServiceTemplateDetail }
  | { type: "service"; record: BusinessServiceDetail };

type DeleteTarget =
  | { type: "template"; id: string; name: string }
  | { type: "service"; id: string; name: string };

/** Converts template task details into editable wizard task inputs. */
function tasksFromTemplate(
  tasks: ServiceTemplateDetail["tasks"],
): ServiceTaskInput[] {
  return tasks.map((task) => ({
    title: task.title,
    description: task.description,
    isRequired: task.isRequired,
    photoRequired: task.photoRequired,
    customerVisible: task.customerVisible,
  }));
}

/** Converts business service task details into editable wizard task inputs. */
function tasksFromService(tasks: BusinessServiceDetail["tasks"]): ServiceTaskInput[] {
  return tasks.map((task) => ({
    title: task.title,
    description: task.description,
    isRequired: task.isRequired,
    photoRequired: task.photoRequired,
    customerVisible: task.customerVisible,
  }));
}

/** Maps a ServiceTemplateDetail into wizard form state for edit mode. */
function templateToForm(template: ServiceTemplateDetail): SetupForm {
  return {
    source: "custom",
    templateId: null,
    name: template.name,
    businessType: (template.businessType as BusinessType) || "Plumbing",
    category: template.category,
    requiredSkill: template.requiredSkill,
    defaultDurationMin: template.defaultDurationMin,
    needsReview: template.needsReview,
    isActive: template.isActive,
    imageUrl: template.imageUrl,
    tasks: tasksFromTemplate(template.tasks),
  };
}

/** Maps a BusinessServiceDetail into wizard form state for edit mode. */
function serviceToForm(service: BusinessServiceDetail): SetupForm {
  return {
    source: service.templateId ? "template" : "custom",
    templateId: service.templateId,
    name: service.name,
    businessType: "Plumbing",
    category: service.category,
    requiredSkill: service.requiredSkill,
    defaultDurationMin: service.defaultDurationMin,
    needsReview: service.needsReview,
    isActive: service.isActive,
    imageUrl: service.imageUrl,
    tasks: tasksFromService(service.tasks),
  };
}

/** Prefills wizard form fields when a business owner selects a template. */
function applyTemplateToForm(
  template: ServiceTemplateDetail,
  current: SetupForm,
): SetupForm {
  return {
    ...current,
    templateId: template.id,
    name: template.name,
    businessType: (template.businessType as BusinessType) || "Plumbing",
    category: template.category,
    requiredSkill: template.requiredSkill,
    defaultDurationMin: template.defaultDurationMin,
    needsReview: template.needsReview,
    imageUrl: template.imageUrl,
    tasks: tasksFromTemplate(template.tasks),
  };
}

/** Validates the current wizard step before allowing navigation or submit. */
function validateSetupStep(
  mode: SetupMode,
  step: SetupStep,
  form: SetupForm,
  isServiceCreate: boolean,
): string | null {
  const detailsStep: SetupStep = isServiceCreate ? 2 : 1;
  const tasksStep: SetupStep = isServiceCreate ? 3 : 2;

  if (isServiceCreate && step === 1) {
    if (form.source === "template" && !form.templateId) {
      return "Please select a service template.";
    }
    return null;
  }

  if (step === detailsStep) {
    if (form.name.trim().length < 2) {
      return "Name must be at least 2 characters.";
    }
    if (mode === "template") {
      if (!BUSINESS_TYPES.some((type) => type.id === form.businessType)) {
        return "Please select a business trade type.";
      }
    } else if (form.category.trim().length < 2) {
      return "Category must be at least 2 characters.";
    }
    if (!form.requiredSkill.trim()) {
      return "Please select a required skill.";
    }
    if (form.defaultDurationMin < 15) {
      return "Duration must be at least 15 minutes.";
    }
    return null;
  }

  if (step === tasksStep) {
    for (let i = 0; i < form.tasks.length; i++) {
      if (form.tasks[i].title.trim().length < 2) {
        return `Task ${i + 1} needs a title.`;
      }
    }
    return null;
  }

  return null;
}

/**
 * Multi-step modal wizard for creating or editing services and templates.
 * Steps: source (services only) → details → tasks → review.
 */
function ServiceSetupWizard({
  mode,
  editTarget,
  templates,
  ownerBusinessType,
  onClose,
  onSaved,
}: {
  mode: SetupMode;
  editTarget: EditTarget | null;
  templates: ServiceTemplateDetail[];
  ownerBusinessType: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = editTarget !== null;
  const isServiceCreate = mode === "service" && !isEdit;
  const maxStep = isServiceCreate ? 4 : 3;
  const [step, setStep] = useState<SetupStep>(1);
  const [form, setForm] = useState<SetupForm>(() => {
    if (editTarget?.type === "template") {
      return templateToForm(editTarget.record);
    }
    if (editTarget?.type === "service") {
      return serviceToForm(editTarget.record);
    }
    return INITIAL_SETUP_FORM;
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const uploadScope =
    mode === "template" ? "service-templates" : "services";

  const progressPercent = Math.round((step / maxStep) * 100);
  const detailsStep: SetupStep = isServiceCreate ? 2 : 1;
  const tasksStep: SetupStep = isServiceCreate ? 3 : 2;
  const reviewStep: SetupStep = isServiceCreate ? 4 : 3;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function updateForm(patch: Partial<SetupForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateTask(index: number, patch: Partial<ServiceTaskInput>) {
    setForm((current) => ({
      ...current,
      tasks: current.tasks.map((task, i) =>
        i === index ? { ...task, ...patch } : task,
      ),
    }));
  }

  function addTask() {
    setForm((current) => ({
      ...current,
      tasks: [...current.tasks, { ...EMPTY_TASK }],
    }));
  }

  function removeTask(index: number) {
    setForm((current) => ({
      ...current,
      tasks: current.tasks.filter((_, i) => i !== index),
    }));
  }

  function selectTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setForm((current) => applyTemplateToForm(template, current));
  }

  function handleContinue() {
    setErrorMessage(null);
    const error = validateSetupStep(mode, step, form, isServiceCreate);
    if (error) {
      setErrorMessage(error);
      return;
    }
    if (step < maxStep) setStep((current) => (current + 1) as SetupStep);
  }

  function handleBack() {
    setErrorMessage(null);
    if (step > 1) setStep((current) => (current - 1) as SetupStep);
  }

  function validateAllSteps(): string | null {
    for (let current = 1; current <= maxStep; current++) {
      const error = validateSetupStep(
        mode,
        current as SetupStep,
        form,
        isServiceCreate,
      );
      if (error) return error;
    }
    return null;
  }

  function buildSubmitPayload() {
    const trimmedTasks = form.tasks.map((task) => ({
      title: task.title.trim(),
      description: task.description.trim(),
      isRequired: task.isRequired,
      photoRequired: task.photoRequired,
      customerVisible: task.customerVisible,
    }));

    if (mode === "template") {
      return {
        name: form.name.trim(),
        businessType: form.businessType,
        category: form.category.trim() || form.businessType,
        requiredSkill: form.requiredSkill,
        defaultDurationMin: form.defaultDurationMin,
        needsReview: form.needsReview,
        isActive: form.isActive,
        imageUrl: form.imageUrl,
        tasks: trimmedTasks,
      };
    }

    return {
      name: form.name.trim(),
      category: form.category.trim(),
      requiredSkill: form.requiredSkill,
      defaultDurationMin: form.defaultDurationMin,
      needsReview: form.needsReview,
      isActive: form.isActive,
      imageUrl: form.imageUrl,
      tasks: trimmedTasks,
    };
  }

  async function handleSave() {
    if (isSubmitting) return;

    setErrorMessage(null);

    const validationError = validateAllSteps();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const updatePayload = buildSubmitPayload();

      let result: { ok: true } | { ok: false; error: string };

      if (isEdit) {
        const path =
          editTarget.type === "template"
            ? `/api/admin/service-templates/${editTarget.record.id}`
            : `/api/services/${editTarget.record.id}`;
        result = await authFetch<{ ok: true }>(path, {
          method: "PATCH",
          body: JSON.stringify(updatePayload),
        });
      } else {
        const createPayload =
          mode === "template"
            ? updatePayload
            : {
                source: form.source,
                templateId: form.source === "template" ? form.templateId : null,
                ...updatePayload,
              };

        const path =
          mode === "template"
            ? "/api/admin/service-templates"
            : "/api/services";

        result = await authFetch<{ ok: true }>(path, {
          method: "POST",
          body: JSON.stringify(createPayload),
        });
      }

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      onClose();
      onSaved();
    } catch {
      setErrorMessage("Could not save. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < reviewStep) {
      handleContinue();
      return;
    }
    void handleSave();
  }

  const title = isEdit
    ? editTarget.type === "template"
      ? "Edit service template"
      : "Edit service"
    : mode === "template"
      ? "Create service template"
      : step === 1
        ? "Add a service"
        : "Service setup";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
              Step {step} of {maxStep}
            </p>
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">
              {title}
            </h2>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant sm:max-w-xs">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            {errorMessage && (
              <div className="mb-5 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
                <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                  error
                </span>
                <span>{errorMessage}</span>
              </div>
            )}

            {isServiceCreate && step === 1 && (
              <div className="flex flex-col gap-4">
                <p className="font-body text-body-md text-on-surface-variant">
                  Start from a platform template or build a custom service with
                  your own tasks.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      {
                        id: "template" as const,
                        label: "From template",
                        description: "Pick a Super Admin template and customize.",
                        icon: "library_books",
                      },
                      {
                        id: "custom" as const,
                        label: "Custom service",
                        description: "Define everything from scratch.",
                        icon: "edit_note",
                      },
                    ] as const
                  ).map((option) => {
                    const isActive = form.source === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          updateForm({
                            source: option.id,
                            templateId:
                              option.id === "custom" ? null : form.templateId,
                            tasks:
                              option.id === "custom" ? [] : form.tasks,
                          })
                        }
                        className={`rounded-xl border p-4 text-left transition-all ${
                          isActive
                            ? "border-2 border-primary bg-primary-fixed/30"
                            : "border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-[28px] ${
                            isActive ? "text-primary" : "text-outline"
                          }`}
                        >
                          {option.icon}
                        </span>
                        <p className="mt-2 font-body text-[14px] font-semibold text-on-surface">
                          {option.label}
                        </p>
                        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                          {option.description}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {form.source === "template" && (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="font-body text-[13px] font-semibold text-on-surface-variant">
                      Select template
                      {ownerBusinessType ? (
                        <span className="font-normal text-on-surface-variant">
                          {" "}
                          — showing {ownerBusinessType} templates only
                        </span>
                      ) : null}
                    </p>
                    {templates.length === 0 ? (
                      <p className="rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 font-body text-[13px] text-on-surface-variant">
                        No active templates yet. Ask your Super Admin to create
                        templates, or choose custom service.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {templates.map((template) => {
                          const isActive = form.templateId === template.id;
                          return (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => selectTemplate(template.id)}
                              className={`rounded-xl border p-3 text-left ${
                                isActive
                                  ? "border-2 border-primary bg-primary-fixed/30"
                                  : "border-outline-variant bg-surface-container-lowest"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <ServiceThumb
                                  imageUrl={template.imageUrl}
                                  skill={template.requiredSkill}
                                  alt={template.name}
                                />
                                <div className="min-w-0">
                                  <p className="font-body text-[14px] font-semibold text-on-surface">
                                    {template.name}
                                  </p>
                                  <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                                    {template.businessType} ·{" "}
                                    {formatServiceDuration(
                                      template.defaultDurationMin,
                                    )}{" "}
                                    · {template.taskCount} tasks
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === detailsStep && (
              <div className="flex flex-col gap-4">
                <ServiceImageField
                  imageUrl={form.imageUrl}
                  scope={uploadScope}
                  onChange={(imageUrl) => updateForm({ imageUrl })}
                  onError={setErrorMessage}
                />

                <Field label="Name" required>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) =>
                      updateForm({ name: event.target.value })
                    }
                    placeholder={
                      mode === "template"
                        ? "e.g. Emergency pipe repair"
                        : "Service name"
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                {mode === "template" ? (
                  <div>
                    <p className="mb-3 font-body text-[13px] font-semibold text-on-surface-variant">
                      What trade is this template for?{" "}
                      <span className="text-error">*</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {BUSINESS_TYPES.map((type) => {
                        const isActive = form.businessType === type.id;
                        return (
                          <button
                            type="button"
                            key={type.id}
                            onClick={() =>
                              updateForm({
                                businessType: type.id,
                                requiredSkill: type.id,
                              })
                            }
                            className={`relative flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-all ${
                              isActive
                                ? "border-2 border-primary bg-primary-fixed/40"
                                : "border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low"
                            }`}
                          >
                            {isActive && (
                              <span className="material-symbols-outlined material-symbols-filled absolute right-1.5 top-1.5 text-[16px] text-primary">
                                check_circle
                              </span>
                            )}
                            <span
                              className={`material-symbols-outlined text-[28px] ${
                                isActive ? "text-primary" : "text-outline"
                              }`}
                            >
                              {type.icon}
                            </span>
                            <span className="font-body text-[11px] font-semibold leading-tight text-on-surface sm:text-[12px]">
                              {type.id}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 font-body text-[12px] text-on-surface-variant">
                      Only businesses in this trade will see this template.
                    </p>
                  </div>
                ) : (
                  <Field label="Category" required>
                    <input
                      type="text"
                      value={form.category}
                      onChange={(event) =>
                        updateForm({ category: event.target.value })
                      }
                      placeholder="e.g. Residential plumbing"
                      className={INPUT_CLASS}
                    />
                  </Field>
                )}

                <Field label="Required skill" required>
                  <select
                    value={form.requiredSkill}
                    onChange={(event) =>
                      updateForm({ requiredSkill: event.target.value })
                    }
                    className={INPUT_CLASS}
                  >
                    {SERVICE_SKILLS.map((skill) => (
                      <option key={skill} value={skill}>
                        {skill}
                      </option>
                    ))}
                  </select>
                </Field>

                <div>
                  <p className="mb-2 font-body text-[13px] font-semibold text-on-surface-variant">
                    Default duration (minutes)
                  </p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {DURATION_PRESETS.map((minutes) => (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() =>
                          updateForm({ defaultDurationMin: minutes })
                        }
                        className={
                          form.defaultDurationMin === minutes
                            ? "rounded-full bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                            : "rounded-full border border-outline-variant px-4 py-2 font-body text-[13px] font-semibold text-on-surface"
                        }
                      >
                        {formatServiceDuration(minutes)}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={form.defaultDurationMin}
                    onChange={(event) =>
                      updateForm({
                        defaultDurationMin: Math.max(
                          15,
                          Number(event.target.value) || 15,
                        ),
                      })
                    }
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3">
                    <input
                      type="checkbox"
                      checked={form.needsReview}
                      onChange={(event) =>
                        updateForm({ needsReview: event.target.checked })
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="font-body text-[13px] text-on-surface">
                      Needs review before assignment
                    </span>
                  </label>

                  <label className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(event) =>
                        updateForm({ isActive: event.target.checked })
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="font-body text-[13px] text-on-surface">
                      Active
                    </span>
                  </label>
                </div>
              </div>
            )}

            {step === tasksStep && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-body text-body-md text-on-surface-variant">
                    Define checklist tasks for this service.
                  </p>
                  <button
                    type="button"
                    onClick={addTask}
                    className="flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-2 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      add
                    </span>
                    Add task
                  </button>
                </div>

                {form.tasks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-outline-variant px-4 py-6 text-center font-body text-[13px] text-on-surface-variant">
                    No tasks yet. Tasks are optional but help staff follow a
                    checklist.
                  </p>
                ) : (
                  form.tasks.map((task, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="font-body text-[13px] font-semibold text-on-surface">
                          Task {index + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeTask(index)}
                          className="text-on-surface-variant hover:text-error"
                          aria-label="Remove task"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            delete
                          </span>
                        </button>
                      </div>
                      <div className="flex flex-col gap-3">
                        <Field label="Title" required>
                          <input
                            type="text"
                            value={task.title}
                            onChange={(event) =>
                              updateTask(index, { title: event.target.value })
                            }
                            className={INPUT_CLASS}
                          />
                        </Field>
                        <Field label="Description" optional>
                          <textarea
                            value={task.description}
                            onChange={(event) =>
                              updateTask(index, {
                                description: event.target.value,
                              })
                            }
                            rows={2}
                            className={`${INPUT_CLASS} resize-none`}
                          />
                        </Field>
                        <div className="flex flex-wrap gap-3">
                          {(
                            [
                              ["isRequired", "Required"],
                              ["photoRequired", "Photo required"],
                              ["customerVisible", "Customer visible"],
                            ] as const
                          ).map(([key, label]) => (
                            <label
                              key={key}
                              className="flex items-center gap-2 font-body text-[12px] text-on-surface"
                            >
                              <input
                                type="checkbox"
                                checked={task[key]}
                                onChange={(event) =>
                                  updateTask(index, {
                                    [key]: event.target.checked,
                                  })
                                }
                                className="h-4 w-4 accent-primary"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {step === reviewStep && (
              <div className="rounded-xl border border-primary/20 bg-primary-fixed/20 p-5">
                <p className="mb-4 font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
                  Review
                </p>
                {form.imageUrl && (
                  <img
                    src={form.imageUrl}
                    alt={form.name || "Service preview"}
                    className="mb-4 h-32 w-32 rounded-xl border border-outline-variant object-cover"
                  />
                )}
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    ["Name", form.name || "—"],
                    ...(mode === "template"
                      ? [["Trade", form.businessType]]
                      : [["Category", form.category || "—"]]),
                    ["Required skill", form.requiredSkill],
                    [
                      "Duration",
                      formatServiceDuration(form.defaultDurationMin),
                    ],
                    ["Needs review", form.needsReview ? "Yes" : "No"],
                    ["Status", form.isActive ? "Active" : "Inactive"],
                    ["Tasks", String(form.tasks.length)],
                    ...(isServiceCreate
                      ? [["Source", form.source === "template" ? "Template" : "Custom"]]
                      : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                        {label}
                      </dt>
                      <dd className="mt-0.5 font-body text-[14px] font-semibold text-on-surface">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
            <button
              type="button"
              onClick={step === 1 ? onClose : handleBack}
              className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
            >
              {step === 1 ? "Cancel" : "Back"}
            </button>

            {step < reviewStep ? (
              <button
                type="button"
                onClick={handleContinue}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary"
              >
                Continue
                <span className="material-symbols-outlined text-[18px]">
                  arrow_forward
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleSave()}
                className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[18px]">
                      progress_activity
                    </span>
                    Saving...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">
                      save
                    </span>
                    {isEdit
                      ? "Save changes"
                      : mode === "template"
                        ? "Create template"
                        : "Create service"}
                  </>
                )}
              </button>
            )}
          </footer>
        </form>
      </div>
    </div>
  );
}

/**
 * Main services dashboard page.
 * Loads data from API, renders table + stats, and opens the setup wizard.
 */
export default function ServicesPage() {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";

  const [services, setServices] = useState<BusinessServiceDetail[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplateDetail[]>([]);
  const [filter, setFilter] = useState<ServiceFilter>("all");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>("service");
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [ownerBusinessType, setOwnerBusinessType] = useState<string | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    if (isSuperAdmin) {
      const result = await authFetch<{ templates: ServiceTemplateDetail[] }>(
        "/api/admin/service-templates",
      );
      if (!result.ok) {
        setErrorMessage(result.error);
        setTemplates([]);
      } else {
        setTemplates(result.data.templates ?? []);
      }
      setServices([]);
      setIsLoading(false);
      return;
    }

    const [servicesResult, templatesResult] = await Promise.all([
      authFetch<{ services: BusinessServiceDetail[] }>("/api/services"),
      authFetch<{ templates: ServiceTemplateDetail[]; businessType?: string }>(
        "/api/service-templates",
      ),
    ]);

    if (!servicesResult.ok) {
      setErrorMessage(servicesResult.error);
      setServices([]);
    } else {
      setServices(servicesResult.data.services ?? []);
    }

    if (!templatesResult.ok) {
      setTemplates([]);
      setOwnerBusinessType(null);
    } else {
      setTemplates(templatesResult.data.templates ?? []);
      setOwnerBusinessType(templatesResult.data.businessType ?? null);
    }

    setIsLoading(false);
  }, [isSuperAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(
    () => ({
      all: services.length,
      active: services.filter((service) => service.isActive).length,
      inactive: services.filter((service) => !service.isActive).length,
    }),
    [services],
  );

  const filteredServices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return services.filter((service) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "active" ? service.isActive : !service.isActive);
      const matchesSearch =
        !query ||
        service.name.toLowerCase().includes(query) ||
        service.category.toLowerCase().includes(query) ||
        service.requiredSkill.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, search, services]);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.businessType.toLowerCase().includes(query) ||
        template.category.toLowerCase().includes(query) ||
        template.requiredSkill.toLowerCase().includes(query),
    );
  }, [search, templates]);

  function requestDeleteTemplate(template: ServiceTemplateDetail) {
    setDeleteTarget({
      type: "template",
      id: template.id,
      name: template.name,
    });
  }

  function requestDeleteService(service: BusinessServiceDetail) {
    setDeleteTarget({
      type: "service",
      id: service.id,
      name: service.name,
    });
  }

  function cancelDelete() {
    if (isDeleting) return;
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || isDeleting) return;

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const path =
        deleteTarget.type === "template"
          ? `/api/admin/service-templates/${deleteTarget.id}`
          : `/api/services/${deleteTarget.id}`;

      const result = await authFetch<{ ok: true }>(path, {
        method: "DELETE",
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      setDeleteTarget(null);
      void load();
    } catch {
      setErrorMessage("Could not delete. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  function openSetup(mode: SetupMode) {
    setEditTarget(null);
    setSetupMode(mode);
    setSetupOpen(true);
  }

  function openEditTemplate(template: ServiceTemplateDetail) {
    setEditTarget({ type: "template", record: template });
    setSetupMode("template");
    setSetupOpen(true);
  }

  function openEditService(service: BusinessServiceDetail) {
    setEditTarget({ type: "service", record: service });
    setSetupMode("service");
    setSetupOpen(true);
  }

  function closeSetup() {
    setSetupOpen(false);
    setEditTarget(null);
  }

  const avgDuration =
    services.length === 0
      ? 0
      : Math.round(
          services.reduce(
            (sum, service) => sum + service.defaultDurationMin,
            0,
          ) / services.length,
        );

  return (
    <DashboardShell
      title="Services"
      subtitle={
        isSuperAdmin
          ? "Create and manage service templates that business owners can use."
          : ownerBusinessType
            ? `Select a template or create custom services for your ${ownerBusinessType} business.`
            : "Select a template or create custom services with tasks for your business."
      }
    >
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        {!isSuperAdmin && (
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="All"
              count={counts.all}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <FilterChip
              label="Active"
              count={counts.active}
              active={filter === "active"}
              onClick={() => setFilter("active")}
            />
            <FilterChip
              label="Inactive"
              count={counts.inactive}
              active={filter === "inactive"}
              onClick={() => setFilter("inactive")}
            />
          </div>
        )}

        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
          <label className="relative flex h-10 w-full items-center sm:w-56">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 text-[18px] text-outline">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                isSuperAdmin ? "Search templates..." : "Search services..."
              }
              className="h-full w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-10 pr-3 font-body text-[13px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-10 items-center gap-2 rounded-lg border border-outline-variant px-3 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[18px]">
              refresh
            </span>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => openSetup(isSuperAdmin ? "template" : "service")}
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {isSuperAdmin ? "Create template" : "Add service"}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body text-body-md">
            <thead className="border-b border-outline-variant bg-surface-container-low text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
              <tr>
                <th className="px-5 py-3">
                  {isSuperAdmin ? "Template" : "Service"}
                </th>
                <th className="hidden px-5 py-3 sm:table-cell">
                  {isSuperAdmin ? "Trade" : "Category"}
                </th>
                <th className="hidden px-5 py-3 md:table-cell">Skill</th>
                <th className="hidden px-5 py-3 md:table-cell">Duration</th>
                <th className="px-5 py-3">Review</th>
                <th className="hidden px-5 py-3 lg:table-cell">Tasks</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-3 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center font-body text-body-md text-on-surface-variant"
                  >
                    <span className="material-symbols-outlined mr-2 animate-spin align-middle text-[18px]">
                      progress_activity
                    </span>
                    Loading...
                  </td>
                </tr>
              ) : isSuperAdmin ? (
                filteredTemplates.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center">
                      <p className="font-body text-body-md text-on-surface-variant">
                        No service templates yet. Create templates for business
                        owners to use.
                      </p>
                      <button
                        type="button"
                        onClick={() => openSetup("template")}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          add
                        </span>
                        Create template
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredTemplates.map((template) => (
                    <tr
                      key={template.id}
                      className="border-b border-outline-variant/60 last:border-b-0 hover:bg-surface-container-low/60"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <ServiceThumb
                            imageUrl={template.imageUrl}
                            skill={template.businessType}
                            alt={template.name}
                          />
                          <p className="font-body text-[14px] font-semibold text-on-surface">
                            {template.name}
                          </p>
                        </div>
                      </td>
                      <td className="hidden px-5 py-4 sm:table-cell">
                        {template.businessType}
                      </td>
                      <td className="hidden px-5 py-4 md:table-cell">
                        {template.requiredSkill}
                      </td>
                      <td className="hidden px-5 py-4 md:table-cell">
                        {formatServiceDuration(template.defaultDurationMin)}
                      </td>
                      <td className="px-5 py-4">
                        {template.needsReview ? "Yes" : "No"}
                      </td>
                      <td className="hidden px-5 py-4 lg:table-cell">
                        {template.taskCount}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            template.isActive
                              ? "bg-primary-fixed text-on-primary-fixed-variant"
                              : "bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          {template.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            title="Edit template"
                            onClick={() => openEditTemplate(template)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                          >
                            <span className="material-symbols-outlined text-[20px]">
                              edit
                            </span>
                          </button>
                          <button
                            type="button"
                            title="Delete template"
                            onClick={() => requestDeleteTemplate(template)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-error"
                          >
                            <span className="material-symbols-outlined text-[20px]">
                              delete
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )
              ) : filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center">
                    <p className="font-body text-body-md text-on-surface-variant">
                      {services.length === 0
                        ? "No services yet. Add from a template or create a custom service."
                        : "No services match your filters."}
                    </p>
                    <button
                      type="button"
                      onClick={() => openSetup("service")}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        add
                      </span>
                      Add service
                    </button>
                  </td>
                </tr>
              ) : (
                filteredServices.map((service) => (
                  <tr
                    key={service.id}
                    className="border-b border-outline-variant/60 last:border-b-0 hover:bg-surface-container-low/60"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <ServiceThumb
                          imageUrl={service.imageUrl}
                          skill={service.requiredSkill}
                          alt={service.name}
                        />
                        <div>
                          <p className="font-body text-[14px] font-semibold text-on-surface">
                            {service.name}
                          </p>
                          {service.templateId && (
                            <p className="font-body text-[11px] text-on-surface-variant">
                              From template
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-5 py-4 sm:table-cell">
                      {service.category}
                    </td>
                    <td className="hidden px-5 py-4 md:table-cell">
                      {service.requiredSkill}
                    </td>
                    <td className="hidden px-5 py-4 md:table-cell">
                      {formatServiceDuration(service.defaultDurationMin)}
                    </td>
                    <td className="px-5 py-4">
                      {service.needsReview ? "Yes" : "No"}
                    </td>
                    <td className="hidden px-5 py-4 lg:table-cell">
                      {service.taskCount}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          service.isActive
                            ? "bg-primary-fixed text-on-primary-fixed-variant"
                            : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {service.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          title="Edit service"
                          onClick={() => openEditService(service)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            edit
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Delete service"
                          onClick={() => requestDeleteService(service)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-error"
                        >
                          <span className="material-symbols-outlined text-[20px]">
                            delete
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!isSuperAdmin && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: "Active services", value: counts.active, icon: "handyman" },
            {
              label: "Avg. duration",
              value:
                services.length === 0 ? "—" : formatServiceDuration(avgDuration),
              icon: "schedule",
            },
            {
              label: "Needs review",
              value: services.filter((service) => service.needsReview).length,
              icon: "report",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding"
            >
              <div className="mb-2 flex items-center gap-2 text-primary">
                <span className="material-symbols-outlined text-[22px]">
                  {stat.icon}
                </span>
                <span className="font-body text-[13px] font-semibold text-on-surface-variant">
                  {stat.label}
                </span>
              </div>
              <p className="font-display text-[24px] font-bold text-on-surface">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {setupOpen ? (
        <ServiceSetupWizard
          key={
            editTarget
              ? `${editTarget.type}-${editTarget.record.id}`
              : `${setupMode}-create`
          }
          mode={setupMode}
          editTarget={editTarget}
          templates={templates.filter((template) => template.isActive)}
          ownerBusinessType={ownerBusinessType}
          onClose={closeSetup}
          onSaved={load}
        />
      ) : null}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title={
          deleteTarget?.type === "template"
            ? "Delete service template?"
            : "Delete service?"
        }
        description={
          deleteTarget
            ? deleteTarget.type === "template"
              ? `Are you sure you want to delete "${deleteTarget.name}"? Business owners will no longer see this template. This cannot be undone.`
              : `Are you sure you want to delete "${deleteTarget.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Yes, delete"
        cancelLabel="No, cancel"
        isLoading={isDeleting}
        onCancel={cancelDelete}
        onConfirm={() => void confirmDelete()}
      />
    </DashboardShell>
  );
}
