/**
 * Client-safe display types (`lib/onboarding/services/display.ts`).
 *
 * Maps Firestore documents (tasks embedded in parent doc) to JSON for API/UI.
 */

/** A checklist task belonging to a business-owned service. */
export type ServiceTaskDetail = {
  id: string;
  serviceId: string;
  title: string;
  description: string;
  isRequired: boolean;
  photoRequired: boolean;
  customerVisible: boolean;
  sortOrder: number;
};

/** A checklist task belonging to a super-admin service template. */
export type ServiceTemplateTaskDetail = {
  id: string;
  templateId: string;
  title: string;
  description: string;
  isRequired: boolean;
  photoRequired: boolean;
  customerVisible: boolean;
  sortOrder: number;
};

/**
 * Full service template as returned to the UI or API.
 * Templates are global and filtered by businessType for each tenant.
 */
export type ServiceTemplateDetail = {
  id: string;
  name: string;
  businessType: string;
  isActive: boolean;
  taskCount: number;
  tasks: ServiceTemplateTaskDetail[];
  createdAt: number | null;
  updatedAt: number | null;
};

/**
 * Full business service as returned to the UI or API.
 * Scoped to a single business via businessId.
 */
export type BusinessServiceDetail = {
  id: string;
  businessId: string;
  templateId: string | null;
  name: string;
  businessType: string;
  requiredSkill: string;
  defaultDurationMin: number;
  isActive: boolean;
  imageUrl: string | null;
  taskCount: number;
  tasks: ServiceTaskDetail[];
  createdAt: number | null;
  updatedAt: number | null;
};

/** Converts a Firestore Timestamp (or similar) to epoch milliseconds. */
export function toMillis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === "function") return fn.call(value);
  }
  return null;
}

/** Formats a duration in minutes as a human-readable string (e.g. "1 hr 30 min"). */
export function formatServiceDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}
