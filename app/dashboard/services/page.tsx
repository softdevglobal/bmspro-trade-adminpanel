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

import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import {
  ServiceDetailDrawer,
  type ServiceViewTarget,
} from "@/components/service-detail-drawer";
import {
  ServiceOwnerChecklistSection,
  ServiceOwnerDetailsStep,
  ServiceOwnerLiveToggle,
  ServiceOwnerSourceStep,
} from "@/components/service-owner-wizard-steps";
import { ServiceSetupReview } from "@/components/service-setup-review";
import { ServiceOwnerCard } from "@/components/service-owner-card";
import { ServiceTemplateCard } from "@/components/service-template-card";
import {
  createWizardTask,
  ServiceTaskSortableList,
  wizardTasksFromInputs,
  type WizardTask,
} from "@/components/service-task-sortable-list";
import { useAuth } from "@/lib/auth/auth-context";
import { auth } from "@/lib/firebase/client";
import type {
  BusinessServiceDetail,
  ServiceTemplateDetail,
} from "@/lib/onboarding/services/display";
import {
  SERVICE_TEMPLATE_TRADES,
  type ServiceTemplateTrade,
} from "@/lib/onboarding/services/template-trades";
import type { BusinessType } from "@/lib/onboarding/types";
import {
  SERVICE_TEMPLATE_DEFAULTS,
  toServiceTaskInput,
} from "@/lib/onboarding/services/types";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  consumeOpenAddService, matchServiceByName, OPEN_ADD_SERVICE_EVENT, OWNER_SERVICE_LIMITS as L, registerServicesPageVoice,
  registerServiceSourceHandler, registerServiceStepHandler, SERVICE_FORM_SECTIONS, SERVICES_CHANGED_EVENT,
} from "@/lib/ai/owner-call/owner-service";

type ServiceFilter = "all" | "active" | "inactive";

type SetupMode = "service" | "template";
type ServiceSource = "template" | "custom";
type SetupStep = 1 | 2 | 3 | 4;

type SetupForm = {
  source: ServiceSource;
  templateId: string | null;
  name: string;
  businessType: BusinessType;
  requiredSkill: string;
  defaultDurationMin: number;
  isActive: boolean;
  imageUrl: string | null;
  tasks: WizardTask[];
};

const INITIAL_SETUP_FORM: SetupForm = {
  source: "template",
  templateId: null,
  name: "",
  businessType: "Plumbing",
  requiredSkill: "Plumbing",
  defaultDurationMin: 60,
  isActive: true,
  imageUrl: null,
  tasks: [],
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

type TemplateTradeFilter = "all" | ServiceTemplateTrade;

/** Trade filter dropdown for super-admin template list. */
function TemplateTradeFilterSelect({
  value,
  onChange,
  counts,
}: {
  value: TemplateTradeFilter;
  onChange: (value: TemplateTradeFilter) => void;
  counts: Record<string, number>;
}) {
  return (
    <label className="relative flex h-10 w-full shrink-0 items-center sm:w-52">
      <span className="material-symbols-outlined pointer-events-none absolute left-3 text-[18px] text-outline">
        handyman
      </span>
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as TemplateTradeFilter)
        }
        aria-label="Filter by trade"
        className="h-full w-full appearance-none rounded-lg border border-outline-variant bg-surface-container-lowest pl-10 pr-9 font-body text-[13px] font-semibold text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="all">All trades ({counts.all ?? 0})</option>
        {SERVICE_TEMPLATE_TRADES.map((trade) => (
          <option key={trade.id} value={trade.id}>
            {trade.id} ({counts[trade.id] ?? 0})
          </option>
        ))}
      </select>
      <span className="material-symbols-outlined pointer-events-none absolute right-2.5 text-[20px] text-outline">
        expand_more
      </span>
    </label>
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
): WizardTask[] {
  return wizardTasksFromInputs(
    tasks.map((task) => ({
      title: task.title,
      description: task.description,
    })),
  );
}

/** Converts business service task details into editable wizard task inputs. */
function tasksFromService(tasks: BusinessServiceDetail["tasks"]): WizardTask[] {
  return wizardTasksFromInputs(
    tasks.map((task) => ({
      title: task.title,
      description: task.description,
    })),
  );
}

/** Normalises stored trade type for the template wizard. */
function normalizeTemplateTrade(trade: string | undefined | null): BusinessType {
  if (SERVICE_TEMPLATE_TRADES.some((type) => type.id === trade)) {
    return trade as BusinessType;
  }
  return "Plumbing";
}

/** Maps a ServiceTemplateDetail into wizard form state for edit mode. */
function templateToForm(template: ServiceTemplateDetail): SetupForm {
  const businessType = normalizeTemplateTrade(template.businessType);
  return {
    source: "custom",
    templateId: null,
    name: template.name,
    businessType,
    requiredSkill: template.businessType,
    defaultDurationMin: SERVICE_TEMPLATE_DEFAULTS.defaultDurationMin,
    isActive: template.isActive,
    imageUrl: null,
    tasks: tasksFromTemplate(template.tasks),
  };
}

/** Maps a BusinessServiceDetail into wizard form state for edit mode. */
function serviceToForm(service: BusinessServiceDetail): SetupForm {
  return {
    source: service.templateId ? "template" : "custom",
    templateId: service.templateId,
    name: service.name,
    businessType: normalizeTemplateTrade(service.businessType),
    requiredSkill: service.requiredSkill,
    defaultDurationMin: service.defaultDurationMin,
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
    requiredSkill: template.businessType,
    defaultDurationMin: SERVICE_TEMPLATE_DEFAULTS.defaultDurationMin,
    imageUrl: null,
    tasks: tasksFromTemplate(template.tasks),
  };
}

function validateTaskList(tasks: WizardTask[]): string | null {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].title.trim().length < 2) {
      return `Task ${i + 1} needs a title.`;
    }
  }
  return null;
}

/** Validates the current wizard step before allowing navigation or submit. */
function validateSetupStep(
  mode: SetupMode,
  step: SetupStep,
  form: SetupForm,
  isServiceCreate: boolean,
): string | null {
  const isOwnerService = mode === "service";
  const detailsStep: SetupStep = isServiceCreate ? 2 : 1;
  const templateTasksStep: SetupStep = 2;

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
      if (!SERVICE_TEMPLATE_TRADES.some((type) => type.id === form.businessType)) {
        return "Please select a business trade type.";
      }
      return null;
    }
    if (form.defaultDurationMin < 15) {
      return "Duration must be at least 15 minutes.";
    }
    if (isOwnerService) {
      return validateTaskList(form.tasks);
    }
    return null;
  }

  if (mode === "template" && step === templateTasksStep) {
    return validateTaskList(form.tasks);
  }

  return null;
}

/**
 * Multi-step modal wizard for creating or editing services and templates.
 * Steps: templates — details → tasks → review.
 * Business services — source → details (incl. tasks) → review.
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
  const isOwnerService = mode === "service";
  /** Owner service edit: Details + Review (2 steps). Create: Source → Details → Review (3). */
  const maxStep: SetupStep = isOwnerService
    ? isServiceCreate
      ? 3
      : 2
    : 3;
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
  /** The popup body scrolls on its own, so keep what changed in view. */
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Where Sophie last worked: "top", a section (data-voice-section) or "task:N" (data-task-number). */
  const [voiceScroll, setVoiceScroll] = useState<{ to: string; at: number } | null>(null);

  const progressPercent = Math.round((step / maxStep) * 100);
  const detailsStep: SetupStep = isServiceCreate ? 2 : 1;
  const templateTasksStep: SetupStep = 2;
  const reviewStep: SetupStep = maxStep as SetupStep;

  // A new step (by hand or by Sophie) starts at its top, as does an error message.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);
  useEffect(() => {
    if (errorMessage) bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [errorMessage]);
  // Bring what Sophie is working on into view and outline it briefly: a section, or one job step.
  useEffect(() => {
    const body = bodyRef.current;
    if (!voiceScroll || !body) return;
    if (voiceScroll.to === "top") {
      body.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const isTask = voiceScroll.to.startsWith("task:");
    const target = isTask
      ? body.querySelector(`[data-task-number="${voiceScroll.to.slice(5)}"]`)
      : body.querySelector(`[data-voice-section="${voiceScroll.to}"]`);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: "smooth", block: isTask ? "center" : "start" });
    const outline = ["ring-2", "ring-primary", "ring-offset-2"];
    target.classList.add(...outline);
    const timer = window.setTimeout(() => target.classList.remove(...outline), 2_000);
    return () => {
      window.clearTimeout(timer);
      target.classList.remove(...outline);
    };
  }, [voiceScroll]);

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

  // Sophie (voice) applies the owner's choice: an existing template shown, or custom.
  useEffect(() => {
    if (!isServiceCreate) return;
    return registerServiceSourceHandler(({ source, templateName }) => {
      setErrorMessage(null);
      if (source === "custom") {
        setForm((current) => ({ ...current, source: "custom", templateId: null, tasks: [] }));
        setStep(2);
        return { status: "CHOSEN", message: "Custom service chosen and the details step is open. Ask for the name, how long it takes and the job steps, one short question at a time, then use service_form_step." };
      }
      const names = templates.map((template) => template.name);
      if (names.length === 0) {
        return { status: "NO_TEMPLATES", message: "There are no templates to use. Offer a custom service instead." };
      }
      const wanted = templateName?.trim().toLowerCase();
      const match = wanted
        ? templates.find((t) => t.name.toLowerCase() === wanted) ??
          templates.find((t) => t.name.toLowerCase().includes(wanted))
        : undefined;
      if (!match) {
        setForm((current) => ({ ...current, source: "template" }));
        return { status: "PICK_TEMPLATE", templates: names, message: "Read out these template names and ask which one, then call choose_service_source again with templateName." };
      }
      setForm((current) => applyTemplateToForm(match, { ...current, source: "template" }));
      return { status: "CHOSEN", message: `Template "${match.name}" is selected on screen. Ask if they want to continue, then use service_form_step with action continue.` };
    });
  }, [isServiceCreate, templates]);

  function updateTask(
    index: number,
    patch: Partial<Pick<WizardTask, "title" | "description">>,
  ) {
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
      tasks: [...current.tasks, createWizardTask()],
    }));
  }

  function removeTask(index: number) {
    setForm((current) => ({
      ...current,
      tasks: current.tasks.filter((_, i) => i !== index),
    }));
  }

  function reorderTasks(fromIndex: number, toIndex: number) {
    setForm((current) => {
      const next = [...current.tasks];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...current, tasks: next };
    });
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

  function resolveOwnerServiceTrade(): string {
    return (
      ownerBusinessType?.trim() ||
      form.businessType ||
      form.requiredSkill.trim() ||
      "General"
    );
  }

  function buildSubmitPayload() {
    const trimmedTasks = form.tasks.map(({ clientKey: _clientKey, ...task }) =>
      toServiceTaskInput({
        title: task.title.trim(),
        description: task.description.trim(),
      }),
    );

    if (mode === "template") {
      return {
        name: form.name.trim(),
        businessType: form.businessType,
        isActive: form.isActive,
        tasks: trimmedTasks,
      };
    }

    const trade = resolveOwnerServiceTrade();

    return {
      name: form.name.trim(),
      businessType: trade,
      requiredSkill: trade,
      defaultDurationMin: form.defaultDurationMin,
      isActive: form.isActive,
      imageUrl: form.imageUrl,
      tasks: trimmedTasks,
    };
  }

  /** Saves the service. Returns null when saved, otherwise the reason it was not (also shown in the popup). */
  async function handleSave(): Promise<string | null> {
    if (isSubmitting) return "Already saving.";
    if (step !== reviewStep) return "The review step is not open.";

    setErrorMessage(null);

    const validationError = validateAllSteps();
    if (validationError) {
      setErrorMessage(validationError);
      return validationError;
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
        return result.error;
      }

      onClose();
      onSaved();
      return null;
    } catch {
      setErrorMessage("Could not save. Please try again.");
      return "Could not save. Please try again.";
    } finally {
      setIsSubmitting(false);
    }
  }

  // Sophie (voice) can fill the form and press Continue / Back / Save, like the owner would.
  const formRef = useRef(form);
  const stepRef = useRef(step);
  const saveRef = useRef(handleSave);
  useEffect(() => {
    formRef.current = form;
    stepRef.current = step;
    saveRef.current = handleSave;
  });
  useEffect(() => {
    if (!isOwnerService) return; // owner services, create or edit (not super-admin templates)
    return registerServiceStepHandler(async (args) => {
      const { action, name, durationMin, isActive, tasks } = args;
      // Scrolling only moves the popup's content, like the owner using the scroll wheel.
      if (action === "scroll_down" || action === "scroll_up") {
        const body = bodyRef.current;
        if (!body) return { status: "NO_FORM", message: "The popup is not showing." };
        const down = action === "scroll_down";
        const atEdge = down
          ? body.scrollTop + body.clientHeight >= body.scrollHeight - 4
          : body.scrollTop <= 4;
        if (atEdge) return { status: "OK", message: down ? "Already at the bottom of the popup." : "Already at the top of the popup." };
        body.scrollBy({ top: (down ? 1 : -1) * Math.round(body.clientHeight * 0.8), behavior: "smooth" });
        return { status: "OK", message: down ? "Scrolled down." : "Scrolled up." };
      }
      setErrorMessage(null);
      const listSteps = (list: WizardTask[]) =>
        list.length ? list.map((task, index) => `${index + 1}. ${task.title.trim() || "(no title)"}`).join("; ") : "none";
      const reviewResult = () => {
        const f = formRef.current;
        return {
          status: "REVIEW",
          message: `Review step is open. Read back: name "${f.name.trim()}", ${f.defaultDurationMin} minutes, ` +
            `${f.isActive ? "live" : "paused"}, steps: ${listSteps(f.tasks)}. Then ask: Should I save this service? Call save only after a clear yes.`,
        };
      };

      // show and the task actions work on the details step; from the review step, go back to it first.
      const onDetails = action === "show" || action.endsWith("_task");
      if (onDetails && stepRef.current !== detailsStep) {
        if (stepRef.current !== reviewStep) {
          return { status: "NOT_ON_DETAILS", message: "Choose a template or custom first, then continue to the details step." };
        }
        stepRef.current = detailsStep;
        setStep(detailsStep);
      }

      if (action === "show") {
        const section = args.section;
        if (!section || !(SERVICE_FORM_SECTIONS as readonly string[]).includes(section)) {
          return { status: "REJECTED", message: `section must be one of: ${SERVICE_FORM_SECTIONS.join(", ")}.` };
        }
        setVoiceScroll({ to: section, at: Date.now() });
        return { status: "OK", message: `The ${section} section is on screen.` };
      }

      if (action === "add_task" || action === "edit_task" || action === "remove_task" || action === "move_task") {
        const list = [...formRef.current.tasks];
        const inRange = (value: number | undefined, max: number): value is number =>
          Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;
        const title = args.title?.trim();
        const description = args.description?.trim();
        if (title && title.length > L.taskTitleMax) return { status: "INVALID", message: `A step title can be at most ${L.taskTitleMax} characters.` };
        if (description && description.length > L.taskDescriptionMax) {
          return { status: "INVALID", message: `A step description can be at most ${L.taskDescriptionMax} characters.` };
        }
        let focus: number; // step number to show afterwards; 0 shows the whole list
        if (action === "add_task") {
          if (!title) return { status: "INVALID", message: "Ask for the new step's title." };
          if (list.length >= L.maxTasks) return { status: "INVALID", message: `A service can have at most ${L.maxTasks} steps.` };
          const at = inRange(args.toNumber, list.length + 1) ? args.toNumber - 1 : list.length;
          list.splice(at, 0, createWizardTask({ title, description: description ?? "" }));
          focus = at + 1;
        } else {
          if (!inRange(args.taskNumber, list.length)) {
            return { status: "INVALID", message: `There ${list.length === 1 ? "is 1 step" : `are ${list.length} steps`}: ${listSteps(list)}. Ask which number.` };
          }
          const index = args.taskNumber - 1;
          if (action === "edit_task") {
            if (!title && description === undefined) return { status: "INVALID", message: "Ask for the new title or description." };
            list[index] = { ...list[index], ...(title ? { title } : {}), ...(description !== undefined ? { description } : {}) };
            focus = index + 1;
          } else if (action === "remove_task") {
            list.splice(index, 1);
            focus = Math.min(index + 1, list.length);
          } else {
            if (!inRange(args.toNumber, list.length)) return { status: "INVALID", message: `Ask which position, 1 to ${list.length}.` };
            const [moved] = list.splice(index, 1);
            list.splice(args.toNumber - 1, 0, moved);
            focus = args.toNumber;
          }
        }
        const next: SetupForm = { ...formRef.current, tasks: list };
        formRef.current = next;
        setForm(next);
        setVoiceScroll({ to: focus > 0 ? `task:${focus}` : "tasks", at: Date.now() });
        return { status: "OK", message: `Done. Steps now: ${listSteps(list)}.` };
      }

      if (name !== undefined || durationMin !== undefined || isActive !== undefined || tasks !== undefined) {
        const next: SetupForm = {
          ...formRef.current,
          ...(name !== undefined ? { name } : {}),
          ...(durationMin !== undefined ? { defaultDurationMin: durationMin } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(tasks !== undefined
            ? { tasks: tasks.map((task) => createWizardTask({ title: task.title, description: task.description ?? "" })) }
            : {}),
        };
        formRef.current = next;
        setForm(next);
        // Show the field that changed (the last one in the form, if several did).
        const changed = tasks !== undefined ? "tasks" : isActive !== undefined ? "live" : durationMin !== undefined ? "duration" : "name";
        setVoiceScroll({ to: stepRef.current === detailsStep ? changed : "top", at: Date.now() });
      }
      const current = stepRef.current;
      if (action === "fill") {
        const f = formRef.current;
        return {
          status: "OK",
          message: `Typed into the form. Now: name "${f.name.trim()}", ${f.defaultDurationMin} minutes, ${f.isActive ? "live" : "paused"}, ` +
            `steps: ${listSteps(f.tasks)}. Ask for anything still missing, or ask if they want to continue.`,
        };
      }
      if (action === "back") {
        const target = Math.max(1, current - 1) as SetupStep;
        stepRef.current = target;
        setStep(target);
        return { status: "OK", message: `Went back to step ${target} of ${maxStep}.` };
      }
      if (action === "continue") {
        const problem = validateSetupStep(mode, current, formRef.current, isServiceCreate);
        if (problem) return { status: "INVALID", message: problem };
        // Already on review (for example after a change there): read it back again so the owner confirms what is shown.
        if (current >= maxStep) return reviewResult();
        const target = (current + 1) as SetupStep;
        stepRef.current = target;
        setStep(target);
        if (target === reviewStep) return reviewResult();
        return {
          status: "OK",
          message: `Step ${target} of ${maxStep} is open (details). Ask for or confirm the name, how long it takes and the job steps, one short question at a time, then continue.`,
        };
      }
      // save
      if (stepRef.current !== reviewStep) {
        return { status: "NOT_AT_REVIEW", message: "Continue to the review step first." };
      }
      const failure = await saveRef.current();
      return failure
        ? { status: "NOT_SAVED", message: failure }
        : { status: "SAVED", message: isEdit ? "The changes are saved. Tell the owner." : "The service was added. Tell the owner it is saved." };
    });
  }, [isOwnerService, isServiceCreate, isEdit, mode, maxStep, reviewStep, detailsStep]);

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

  const headerSubtitle =
    mode === "template"
      ? isEdit
        ? "Update trade, name, tasks, and visibility for this template."
        : "Business owners in the selected trade can add this template to their catalog."
      : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 grid h-[94dvh] max-h-[94dvh] w-full grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:h-[min(92dvh,calc(100dvh-2rem))] sm:max-h-[min(92dvh,calc(100dvh-2rem))] sm:rounded-2xl ${
          mode === "template" ? "max-w-5xl" : "max-w-4xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            {mode !== "template" && (
              <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
                Step {step} of {maxStep}
              </p>
            )}
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">
              {title}
            </h2>
            {headerSubtitle ? (
              <p className="mt-1 font-body text-body-md text-on-surface-variant">
                {headerSubtitle}
              </p>
            ) : null}
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant sm:max-w-md">
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

        <form
          id="service-setup-wizard-form"
          onSubmit={handleFormSubmit}
          className="min-h-0 overflow-hidden"
        >
          <div ref={bodyRef} className="h-full min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
            {errorMessage && (
              <div className="mb-5 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
                <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                  error
                </span>
                <span>{errorMessage}</span>
              </div>
            )}

            {isServiceCreate && step === 1 && (
              <ServiceOwnerSourceStep
                source={form.source}
                templateId={form.templateId}
                templates={templates}
                ownerBusinessType={ownerBusinessType}
                onSourceChange={(source) =>
                  updateForm({
                    source,
                    templateId: source === "custom" ? null : form.templateId,
                    tasks: source === "custom" ? [] : form.tasks,
                  })
                }
                onTemplateSelect={selectTemplate}
              />
            )}

            {step === detailsStep && (
              <div className="flex flex-col gap-5">
                {mode === "template" ? (
                  <>
                    <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
                      Step {step} of {maxStep}
                    </p>
                    <header>
                      <h3 className="font-display text-headline-sm font-semibold text-on-surface">
                        Template details
                      </h3>
                      <p className="mt-1 font-body text-body-md text-on-surface-variant">
                        What trade is this template for?
                      </p>
                    </header>

                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                      {SERVICE_TEMPLATE_TRADES.map((type) => {
                        const isActive = form.businessType === type.id;
                        return (
                          <button
                            type="button"
                            key={type.id}
                            onClick={() =>
                              updateForm({
                                businessType: type.id,
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
                    <p className="-mt-2 font-body text-[12px] text-on-surface-variant">
                      Only businesses in this trade will see this template.
                    </p>

                    <Field label="Name" required>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(event) =>
                          updateForm({ name: event.target.value })
                        }
                        placeholder="e.g. Emergency pipe repair"
                        className={INPUT_CLASS}
                      />
                    </Field>

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
                        Active — visible to matching businesses
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="flex flex-col gap-5">
                    <ServiceOwnerDetailsStep
                      form={{
                        name: form.name,
                        defaultDurationMin: form.defaultDurationMin,
                        imageUrl: form.imageUrl,
                      }}
                      onChange={updateForm}
                      onUploadImage={(file) =>
                        uploadServiceImageFile(file, "services")
                      }
                      onError={(message) => setErrorMessage(message)}
                    />
                    <ServiceOwnerChecklistSection
                      tasks={form.tasks}
                      onAddTask={addTask}
                      onUpdateTask={updateTask}
                      onRemoveTask={removeTask}
                      onReorderTasks={reorderTasks}
                    />
                    <ServiceOwnerLiveToggle
                      isActive={form.isActive}
                      onChange={(isActive) => updateForm({ isActive })}
                    />
                  </div>
                )}
              </div>
            )}

            {mode === "template" && step === templateTasksStep && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-body text-body-md text-on-surface-variant">
                    Define checklist tasks for this template.
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
                  <>
                    {form.tasks.length > 1 ? (
                      <p className="font-body text-[12px] text-on-surface-variant">
                        Drag the handle on a task to change its order.
                      </p>
                    ) : null}
                    <ServiceTaskSortableList
                      tasks={form.tasks}
                      onReorder={reorderTasks}
                      onUpdate={updateTask}
                      onRemove={removeTask}
                    />
                  </>
                )}
              </div>
            )}

            {step === reviewStep ? (
              <ServiceSetupReview
                mode={mode}
                isServiceCreate={isServiceCreate}
                form={form}
              />
            ) : null}
          </div>
        </form>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-variant bg-background px-5 py-4 shadow-[0_-8px_24px_rgba(0,42,150,0.08)] sm:px-6">
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
              onClick={(event) => {
                event.preventDefault();
                handleContinue();
              }}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary"
            >
              Continue
              <span className="material-symbols-outlined text-[18px]">
                arrow_forward
              </span>
            </button>
          ) : (
            <button
              type="submit"
              form="service-setup-wizard-form"
              disabled={isSubmitting}
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
  const [selectedView, setSelectedView] = useState<ServiceViewTarget | null>(
    null,
  );
  const [tradeFilter, setTradeFilter] = useState<TemplateTradeFilter>("all");

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

  // Reload when Sophie adds a service by voice (fired by components/owner-voice-session.tsx).
  useEffect(() => {
    const reload = () => { void load(); };
    window.addEventListener(SERVICES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SERVICES_CHANGED_EVENT, reload);
  }, [load]);

  // Open the Add service popup when Sophie asks (before or after this page mounts).
  useEffect(() => {
    if (isSuperAdmin) return;
    const open = () => {
      if (consumeOpenAddService()) {
        setEditTarget(null);
        setSetupMode("service");
        setSetupOpen(true);
      }
    };
    open();
    window.addEventListener(OPEN_ADD_SERVICE_EVENT, open);
    return () => window.removeEventListener(OPEN_ADD_SERVICE_EVENT, open);
  }, [isSuperAdmin]);

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
        service.businessType.toLowerCase().includes(query) ||
        service.requiredSkill.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, search, services]);

  const templateCountsByTrade = useMemo(() => {
    const counts: Record<string, number> = { all: templates.length };
    for (const trade of SERVICE_TEMPLATE_TRADES) {
      counts[trade.id] = templates.filter(
        (template) => template.businessType === trade.id,
      ).length;
    }
    return counts;
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesTrade =
        tradeFilter === "all" || template.businessType === tradeFilter;
      const matchesSearch =
        !query ||
        template.name.toLowerCase().includes(query) ||
        template.businessType.toLowerCase().includes(query);
      return matchesTrade && matchesSearch;
    });
  }, [search, templates, tradeFilter]);

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

  /** Deletes the target. Returns null when deleted, otherwise the reason it was not (also shown on the page). */
  async function confirmDelete(): Promise<string | null> {
    if (!deleteTarget) return "Nothing is selected to delete.";
    if (isDeleting) return "Already deleting.";

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
        return result.error;
      }

      setDeleteTarget(null);
      void load();
      return null;
    } catch {
      setErrorMessage("Could not delete. Please try again.");
      return "Could not delete. Please try again.";
    } finally {
      setIsDeleting(false);
    }
  }

  // Sophie (voice) can open a service to edit or ask to delete one, like the owner using a card's buttons.
  // Registered only once the list has loaded, so a name Sophie sends can always be matched.
  const servicesRef = useRef(services);
  const deleteTargetRef = useRef(deleteTarget);
  const confirmDeleteRef = useRef(confirmDelete);
  useEffect(() => {
    servicesRef.current = services;
    deleteTargetRef.current = deleteTarget;
    confirmDeleteRef.current = confirmDelete;
  });
  useEffect(() => {
    if (isSuperAdmin || isLoading) return;
    return registerServicesPageVoice({
      openEdit(serviceName) {
        const found = matchServiceByName(servicesRef.current, serviceName);
        if (!found.ok) return found.result;
        const service = found.service;
        setDeleteTarget(null);
        setSelectedView(null);
        setEditTarget({ type: "service", record: service });
        setSetupMode("service");
        setSetupOpen(true);
        const steps = service.tasks.map((task) => task.title.trim()).filter(Boolean).join("; ") || "none";
        return {
          status: "OPENED",
          message: `The Edit service popup is open for "${service.name}": ${service.defaultDurationMin} minutes, ` +
            `${service.isActive ? "live" : "not live"}, steps: ${steps}. Ask what to change, then use service_form_step.`,
        };
      },
      prepareDelete(serviceName) {
        const found = matchServiceByName(servicesRef.current, serviceName);
        if (!found.ok) return found.result;
        const service = found.service;
        setSetupOpen(false);
        setEditTarget(null);
        setSelectedView(null);
        setDeleteTarget({ type: "service", id: service.id, name: service.name });
        return {
          status: "CONFIRM_DELETE",
          message: `The delete confirmation for "${service.name}" is on screen. Nothing is deleted yet. ` +
            `Ask: Should I delete ${service.name}? This cannot be undone. Use confirm only after a clear yes, otherwise cancel.`,
        };
      },
      async confirmDelete() {
        const target = deleteTargetRef.current;
        if (!target || target.type !== "service") {
          return { status: "NO_DELETE", message: "No delete is waiting on screen. Use delete_service with action prepare first." };
        }
        const failure = await confirmDeleteRef.current();
        return failure
          ? { status: "NOT_DELETED", message: `It was not deleted: ${failure}` }
          : { status: "DELETED", message: `"${target.name}" is deleted. Tell the owner.` };
      },
      cancelDelete() {
        setDeleteTarget(null);
        return { status: "CANCELLED", message: "Nothing was deleted." };
      },
    });
  }, [isSuperAdmin, isLoading]);

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

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          {!isSuperAdmin ? (
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
          ) : null}

          <div
            className={`flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center ${isSuperAdmin ? "sm:ml-auto" : ""}`}
          >
            {isSuperAdmin ? (
              <TemplateTradeFilterSelect
                value={tradeFilter}
                onChange={setTradeFilter}
                counts={templateCountsByTrade}
              />
            ) : null}
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
              className="flex h-10 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">
                refresh
              </span>
              Refresh
            </button>
            <button
              type="button"
              onClick={() => openSetup(isSuperAdmin ? "template" : "service")}
              className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {isSuperAdmin ? "Create template" : "Add service"}
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
              error
            </span>
            <span>{errorMessage}</span>
          </div>
        )}

        {isSuperAdmin ? (
          <>
            {isLoading ? (
              <div className="flex items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest py-16 font-body text-body-md text-on-surface-variant">
                <span className="material-symbols-outlined mr-2 animate-spin text-[20px]">
                  progress_activity
                </span>
                Loading templates...
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-14 text-center">
                <p className="font-body text-body-md text-on-surface-variant">
                  {templates.length === 0
                    ? "No service templates yet. Create templates for business owners to use."
                    : tradeFilter !== "all"
                      ? `No templates for ${tradeFilter}${search.trim() ? ` matching "${search.trim()}"` : ""}.`
                      : `No templates match your search.`}
                </p>
                {templates.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => openSetup("template")}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      add
                    </span>
                    Create template
                  </button>
                ) : tradeFilter !== "all" || search.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTradeFilter("all");
                      setSearch("");
                    }}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-outline-variant px-4 py-2 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container-low"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredTemplates.map((template) => (
                  <ServiceTemplateCard
                    key={template.id}
                    template={template}
                    onView={() =>
                      setSelectedView({ type: "template", record: template })
                    }
                    onEdit={() => openEditTemplate(template)}
                    onDelete={() => requestDeleteTemplate(template)}
                  />
                ))}
              </div>
            )}
          </>
        ) : isLoading ? (
          <div className="flex items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest py-16 font-body text-body-md text-on-surface-variant">
            <span className="material-symbols-outlined mr-2 animate-spin text-[20px]">
              progress_activity
            </span>
            Loading services...
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-14 text-center">
            <p className="font-body text-body-md text-on-surface-variant">
              {services.length === 0
                ? "No services yet. Add from a template or create a custom service."
                : "No services match your filters."}
            </p>
            {services.length === 0 ? (
              <button
                type="button"
                onClick={() => openSetup("service")}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add service
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 justify-items-stretch sm:grid-cols-[repeat(auto-fill,18.5rem)] sm:justify-items-start sm:gap-4">
            {filteredServices.map((service) => (
              <ServiceOwnerCard
                key={service.id}
                service={service}
                onView={() =>
                  setSelectedView({ type: "service", record: service })
                }
                onEdit={() => openEditService(service)}
                onDelete={() => requestDeleteService(service)}
              />
            ))}
          </div>
        )}
      </div>

      <ServiceDetailDrawer
        target={selectedView}
        onClose={() => setSelectedView(null)}
      />

      {!isSuperAdmin && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            {
              label: "Active services",
              value: counts.active,
              icon: "handyman",
              hint: "Available to book",
            },
            {
              label: "Inactive",
              value: counts.inactive,
              icon: "pause_circle",
              hint: "Hidden from catalog",
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
              <p className="font-numeric text-[24px] font-bold text-on-surface">
                {stat.value}
              </p>
              {"hint" in stat && stat.hint ? (
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  {stat.hint}
                </p>
              ) : null}
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
    </>
  );
}
