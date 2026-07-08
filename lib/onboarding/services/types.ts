/**
 * Service domain types and validation (`lib/onboarding/services/types.ts`).
 *
 * Validates API request bodies before server.ts writes to Firestore.
 * See collections.ts for persisted document shapes and README.md for the save flow.
 */

import {
  BUSINESS_TYPES,
  type BusinessType,
} from "@/lib/onboarding/types";
import {
  SERVICE_TEMPLATE_TRADES,
  type ServiceTemplateTrade,
} from "@/lib/onboarding/services/template-trades";

export {
  SERVICE_TEMPLATE_TRADES,
  type ServiceTemplateTrade,
} from "@/lib/onboarding/services/template-trades";

/** Default scheduling fields for templates when not collected in the UI. */
export const SERVICE_TEMPLATE_DEFAULTS = {
  defaultDurationMin: 60,
} as const;

/** Skills that can be required to perform a service (trade types + extras). */
export const SERVICE_SKILLS = [
  ...BUSINESS_TYPES.map((t) => t.id),
  "Security",
  "General",
] as const;

export type ServiceSkill = (typeof SERVICE_SKILLS)[number];

/** Defaults for task flags when the admin UI only collects title and description. */
export const SERVICE_TASK_FIELD_DEFAULTS = {
  isRequired: true,
  photoRequired: false,
  customerVisible: true,
} as const;

/** Payload shape for a single checklist task when creating or updating. */
export type ServiceTaskInput = {
  title: string;
  description: string;
};

/** Builds a task payload from wizard title/description fields. */
export function toServiceTaskInput(task: {
  title: string;
  description: string;
}): ServiceTaskInput {
  return {
    title: task.title,
    description: task.description,
  };
}

/** Full payload for creating or updating a super-admin service template. */
export type ServiceTemplateInput = {
  name: string;
  businessType: ServiceTemplateTrade;
  isActive?: boolean;
  tasks: ServiceTaskInput[];
};

/** Payload for a business owner creating a service from a template or custom data. */
export type CreateBusinessServiceInput = {
  source: "template" | "custom";
  templateId?: string | null;
  name: string;
  businessType: string;
  requiredSkill: string;
  defaultDurationMin: number;
  isActive?: boolean;
  imageUrl?: string | null;
  tasks: ServiceTaskInput[];
};

/** Partial update payload for an existing business service. */
export type UpdateBusinessServiceInput = Partial<
  Omit<CreateBusinessServiceInput, "source" | "templateId" | "tasks">
> & {
  tasks?: ServiceTaskInput[];
};

export type UpdateServiceTemplateInput = Partial<ServiceTemplateInput>;

/** Returns true when value is a non-empty trimmed string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Parses and validates a single task object from an API request body. */
function parseTask(raw: unknown, index: number): ServiceTaskInput | string {
  if (!raw || typeof raw !== "object") {
    return `Task ${index + 1} is invalid.`;
  }
  const task = raw as Record<string, unknown>;
  const title = typeof task.title === "string" ? task.title.trim() : "";
  const description =
    typeof task.description === "string" ? task.description.trim() : "";

  if (title.length < 2) {
    return `Task ${index + 1} needs a title (at least 2 characters).`;
  }

  return { title, description };
}

/** Parses and validates an array of tasks from an API request body. */
function parseTasks(raw: unknown): ServiceTaskInput[] | string {
  if (!Array.isArray(raw)) return "Tasks must be an array.";
  const tasks: ServiceTaskInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseTask(raw[i], i);
    if (typeof parsed === "string") return parsed;
    tasks.push(parsed);
  }
  return tasks;
}

/** Validates an optional HTTPS image URL from an API request body. */
function parseImageUrl(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Image URL must be a string." };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return { ok: false, error: "Image URL must use HTTPS." };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: "Image URL is invalid." };
  }
}

/**
 * Validates shared service fields used by both templates and business services:
 * name, businessType, skill, duration, active flag, and image URL.
 */
function validateServiceCoreFields(
  raw: Record<string, unknown>,
  options: { requireSchedulingFields?: boolean } = {},
): {
  ok: true;
  value: {
    name: string;
    businessType: string;
    requiredSkill: string;
    defaultDurationMin: number;
    isActive: boolean;
    imageUrl: string | null;
  };
} | { ok: false; error: string } {
  const requireSchedulingFields = options.requireSchedulingFields ?? true;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const businessTypeRaw =
    typeof raw.businessType === "string"
      ? raw.businessType.trim()
      : typeof raw.category === "string"
        ? raw.category.trim()
        : "";
  const requiredSkill =
    typeof raw.requiredSkill === "string" ? raw.requiredSkill.trim() : "";
  const defaultDurationMin = Number(raw.defaultDurationMin);
  const isActive = raw.isActive !== false;

  if (name.length < 2) {
    return { ok: false, error: "Service name must be at least 2 characters." };
  }
  if (businessTypeRaw.length < 2) {
    return {
      ok: false,
      error: "Business type must be at least 2 characters.",
    };
  }

  if (requireSchedulingFields) {
    if (!requiredSkill) {
      return { ok: false, error: "Please select a required skill." };
    }
    if (
      Number.isNaN(defaultDurationMin) ||
      defaultDurationMin < 15 ||
      defaultDurationMin > 24 * 60
    ) {
      return {
        ok: false,
        error: "Duration must be between 15 minutes and 24 hours.",
      };
    }
  }

  const imageUrl = parseImageUrl(raw.imageUrl);
  if (!imageUrl.ok) return imageUrl;

  const resolvedSkill = requireSchedulingFields
    ? requiredSkill
    : requiredSkill || businessTypeRaw;
  const resolvedDuration = requireSchedulingFields
    ? Math.round(defaultDurationMin)
    : SERVICE_TEMPLATE_DEFAULTS.defaultDurationMin;

  return {
    ok: true,
    value: {
      name,
      businessType: businessTypeRaw,
      requiredSkill: resolvedSkill,
      defaultDurationMin: resolvedDuration,
      isActive,
      imageUrl: imageUrl.value,
    },
  };
}

/**
 * Validates a super-admin service template create/update request.
 * Requires a valid business trade type so templates can be filtered per tenant.
 */
export function validateServiceTemplateInput(
  raw: unknown,
): { ok: true; value: ServiceTemplateInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }
  const body = raw as Record<string, unknown>;

  const businessTypeRaw =
    typeof body.businessType === "string" ? body.businessType.trim() : "";
  if (!SERVICE_TEMPLATE_TRADES.some((type) => type.id === businessTypeRaw)) {
    return { ok: false, error: "Please select a business trade type." };
  }
  const businessType = businessTypeRaw as ServiceTemplateTrade;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return { ok: false, error: "Service name must be at least 2 characters." };
  }

  const tasks = parseTasks(body.tasks);
  if (typeof tasks === "string") return { ok: false, error: tasks };

  return {
    ok: true,
    value: {
      name,
      businessType,
      isActive: body.isActive !== false,
      tasks,
    },
  };
}

/**
 * Validates a business-owner request to create a service (from template or custom).
 */
export function validateCreateBusinessServiceInput(
  raw: unknown,
): { ok: true; value: CreateBusinessServiceInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }
  const body = raw as Record<string, unknown>;
  const source = body.source;

  if (source !== "template" && source !== "custom") {
    return { ok: false, error: "Source must be template or custom." };
  }

  const core = validateServiceCoreFields(body);
  if (!core.ok) return core;

  const tasks = parseTasks(body.tasks);
  if (typeof tasks === "string") return { ok: false, error: tasks };

  const templateId =
    typeof body.templateId === "string" ? body.templateId.trim() : null;

  if (source === "template" && !templateId) {
    return { ok: false, error: "Please select a service template." };
  }

  return {
    ok: true,
    value: {
      source,
      templateId,
      ...core.value,
      tasks,
    },
  };
}

/** Validates a partial update payload for an existing business service. */
export function validateUpdateBusinessServiceInput(
  raw: unknown,
): { ok: true; value: UpdateBusinessServiceInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }
  const body = raw as Record<string, unknown>;
  const value: UpdateBusinessServiceInput = {};

  if ("name" in body) {
    if (!isNonEmptyString(body.name) || body.name.trim().length < 2) {
      return { ok: false, error: "Service name must be at least 2 characters." };
    }
    value.name = body.name.trim();
  }
  if ("businessType" in body || "category" in body) {
    const trade =
      typeof body.businessType === "string"
        ? body.businessType.trim()
        : typeof body.category === "string"
          ? body.category.trim()
          : "";
    if (!trade || trade.length < 2) {
      return {
        ok: false,
        error: "Business type must be at least 2 characters.",
      };
    }
    value.businessType = trade;
  }
  if ("requiredSkill" in body) {
    if (!isNonEmptyString(body.requiredSkill)) {
      return { ok: false, error: "Required skill is invalid." };
    }
    value.requiredSkill = body.requiredSkill.trim();
  }
  if ("defaultDurationMin" in body) {
    const duration = Number(body.defaultDurationMin);
    if (Number.isNaN(duration) || duration < 15 || duration > 24 * 60) {
      return {
        ok: false,
        error: "Duration must be between 15 minutes and 24 hours.",
      };
    }
    value.defaultDurationMin = Math.round(duration);
  }
  if ("isActive" in body) value.isActive = Boolean(body.isActive);
  if ("imageUrl" in body) {
    const imageUrl = parseImageUrl(body.imageUrl);
    if (!imageUrl.ok) return imageUrl;
    value.imageUrl = imageUrl.value;
  }
  if ("tasks" in body) {
    const tasks = parseTasks(body.tasks);
    if (typeof tasks === "string") return { ok: false, error: tasks };
    value.tasks = tasks;
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: "No fields to update." };
  }

  return { ok: true, value };
}

/** Returns a Material icon name for a given service skill label. */
export function iconForServiceSkill(skill: string): string {
  const fromBusiness = BUSINESS_TYPES.find((t) => t.id === skill);
  if (fromBusiness) return fromBusiness.icon;
  if (skill === "Security") return "security";
  return "handyman";
}
