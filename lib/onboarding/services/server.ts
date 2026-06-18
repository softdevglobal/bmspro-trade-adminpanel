/**
 * Server-side CRUD and auth for the services system.
 *
 * Tasks are embedded as a `tasks` array on each service_templates and
 * services document (single write per create/update).
 */

import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  COLLECTIONS,
  LEGACY_COLLECTIONS,
  type EmbeddedTaskRecord,
} from "@/lib/onboarding/services/collections";
import {
  toMillis,
  type BusinessServiceDetail,
  type ServiceTaskDetail,
  type ServiceTemplateDetail,
  type ServiceTemplateTaskDetail,
} from "@/lib/onboarding/services/display";
import {
  SERVICE_TASK_FIELD_DEFAULTS,
  SERVICE_TEMPLATE_DEFAULTS,
  validateCreateBusinessServiceInput,
  validateServiceTemplateInput,
  validateUpdateBusinessServiceInput,
  type CreateBusinessServiceInput,
  type ServiceTaskInput,
  type ServiceTemplateInput,
  type UpdateBusinessServiceInput,
} from "@/lib/onboarding/services/types";
import { assertBusinessActive } from "@/lib/onboarding/business-status";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

export { requireSuperAdmin };

type AuthError = { ok: false; status: number; error: string };

export type BusinessOwnerAuth = {
  ok: true;
  uid: string;
  email: string | undefined;
  businessId: string;
};

export type SessionAuth =
  | { ok: true; role: "super_admin"; uid: string; email: string | undefined }
  | {
      ok: true;
      role: "business_owner";
      uid: string;
      email: string | undefined;
      businessId: string;
    };

/** Verifies Firebase ID token from Authorization: Bearer header. */
async function verifyBearerToken(
  req: Request,
): Promise<
  | { ok: true; uid: string; email: string | undefined; claims: Record<string, unknown> }
  | AuthError
> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return {
      ok: true,
      uid: decoded.uid,
      email: decoded.email,
      claims: decoded as unknown as Record<string, unknown>,
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

/** Requires a signed-in business owner or admin with a businessId claim. */
export async function requireBusinessOwner(
  req: Request,
): Promise<BusinessOwnerAuth | AuthError> {
  const token = await verifyBearerToken(req);
  if (!token.ok) return token;

  const businessId =
    typeof token.claims.businessId === "string" ? token.claims.businessId : null;
  const role = token.claims.role;

  if (
    !businessId ||
    (role !== "owner" && role !== "admin")
  ) {
    return { ok: false, status: 403, error: "Business owner access required." };
  }

  const accessDenied = await assertBusinessActive(businessId);
  if (accessDenied) {
    return accessDenied;
  }

  return {
    ok: true,
    uid: token.uid,
    email: token.email,
    businessId,
  };
}

/** Accepts either super admin or business owner; used for shared endpoints. */
export async function requireSession(
  req: Request,
): Promise<SessionAuth | AuthError> {
  const superAdmin = await requireSuperAdmin(req);
  if (superAdmin.ok) {
    return {
      ok: true,
      role: "super_admin",
      uid: superAdmin.uid,
      email: superAdmin.email,
    };
  }

  const owner = await requireBusinessOwner(req);
  if (owner.ok) {
    return {
      ok: true,
      role: "business_owner",
      uid: owner.uid,
      email: owner.email,
      businessId: owner.businessId,
    };
  }

  return owner;
}

/** Converts API task input into the embedded array shape stored on the parent document. */
function buildEmbeddedTasks(tasks: ServiceTaskInput[]): EmbeddedTaskRecord[] {
  return tasks.map((task, index) => ({
    id: randomUUID(),
    title: task.title,
    description: task.description,
    sortOrder: index,
  }));
}

/** Parses embedded template tasks from a Firestore document field. */
function parseEmbeddedTemplateTasks(
  raw: unknown,
  templateId: string,
): ServiceTemplateTaskDetail[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const task = item as Record<string, unknown>;
      return {
        id: typeof task.id === "string" ? task.id : `task-${index}`,
        templateId,
        title: typeof task.title === "string" ? task.title : "",
        description: typeof task.description === "string" ? task.description : "",
        isRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.isRequired),
        photoRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.photoRequired),
        customerVisible: Boolean(SERVICE_TASK_FIELD_DEFAULTS.customerVisible),
        sortOrder: typeof task.sortOrder === "number" ? task.sortOrder : index,
      };
    })
    .filter((task): task is ServiceTemplateTaskDetail => task !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Parses embedded service tasks from a Firestore document field. */
function parseEmbeddedServiceTasks(
  raw: unknown,
  serviceId: string,
): ServiceTaskDetail[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const task = item as Record<string, unknown>;
      return {
        id: typeof task.id === "string" ? task.id : `task-${index}`,
        serviceId,
        title: typeof task.title === "string" ? task.title : "",
        description: typeof task.description === "string" ? task.description : "",
        isRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.isRequired),
        photoRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.photoRequired),
        customerVisible: Boolean(SERVICE_TASK_FIELD_DEFAULTS.customerVisible),
        sortOrder: typeof task.sortOrder === "number" ? task.sortOrder : index,
      };
    })
    .filter((task): task is ServiceTaskDetail => task !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Loads template tasks from legacy subcollection (pre-embedded schema). */
async function loadLegacyTemplateTasks(
  templateId: string,
): Promise<ServiceTemplateTaskDetail[]> {
  const snapshot = await adminDb
    .collection(LEGACY_COLLECTIONS.SERVICE_TEMPLATE_TASKS)
    .where("templateId", "==", templateId)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        templateId,
        title: data.title ?? "",
        description: data.description ?? "",
        isRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.isRequired),
        photoRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.photoRequired),
        customerVisible: Boolean(SERVICE_TASK_FIELD_DEFAULTS.customerVisible),
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Loads service tasks from legacy subcollection (pre-embedded schema). */
async function loadLegacyServiceTasks(
  serviceId: string,
): Promise<ServiceTaskDetail[]> {
  const snapshot = await adminDb
    .collection(LEGACY_COLLECTIONS.SERVICE_TASKS)
    .where("serviceId", "==", serviceId)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        serviceId,
        title: data.title ?? "",
        description: data.description ?? "",
        isRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.isRequired),
        photoRequired: Boolean(SERVICE_TASK_FIELD_DEFAULTS.photoRequired),
        customerVisible: Boolean(SERVICE_TASK_FIELD_DEFAULTS.customerVisible),
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Resolves tasks from embedded array or legacy subcollection. */
async function resolveTemplateTasks(
  doc: DocumentSnapshot,
): Promise<ServiceTemplateTaskDetail[]> {
  const data = doc.data() ?? {};
  if (Array.isArray(data.tasks)) {
    return parseEmbeddedTemplateTasks(data.tasks, doc.id);
  }
  return loadLegacyTemplateTasks(doc.id);
}

/** Resolves tasks from embedded array or legacy subcollection. */
async function resolveServiceTasks(
  doc: DocumentSnapshot,
): Promise<ServiceTaskDetail[]> {
  const data = doc.data() ?? {};
  if (Array.isArray(data.tasks)) {
    return parseEmbeddedServiceTasks(data.tasks, doc.id);
  }
  return loadLegacyServiceTasks(doc.id);
}

/** Maps a Firestore service_templates document to ServiceTemplateDetail. */
async function mapTemplateDoc(
  doc: DocumentSnapshot,
): Promise<ServiceTemplateDetail> {
  const data = doc.data() ?? {};
  const tasks = await resolveTemplateTasks(doc);

  return {
    id: doc.id,
    name: data.name ?? "",
    businessType: data.businessType ?? data.category ?? "",
    isActive: data.isActive !== false,
    taskCount: tasks.length,
    tasks,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Maps a Firestore services document to BusinessServiceDetail. */
async function mapServiceDoc(
  doc: DocumentSnapshot,
): Promise<BusinessServiceDetail> {
  const data = doc.data() ?? {};
  const tasks = await resolveServiceTasks(doc);

  return {
    id: doc.id,
    businessId: data.businessId ?? "",
    templateId:
      typeof data.templateId === "string" ? data.templateId : null,
    name: data.name ?? "",
    businessType: data.businessType ?? data.category ?? "",
    requiredSkill: data.requiredSkill ?? "",
    defaultDurationMin:
      typeof data.defaultDurationMin === "number" ? data.defaultDurationMin : 60,
    isActive: data.isActive !== false,
    imageUrl:
      typeof data.imageUrl === "string" && data.imageUrl.trim()
        ? data.imageUrl.trim()
        : null,
    taskCount: tasks.length,
    tasks,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Builds API template detail from validated input (avoids extra Firestore read after write). */
function buildTemplateDetailFromInput(
  id: string,
  value: ServiceTemplateInput,
): ServiceTemplateDetail {
  const embeddedTasks = buildEmbeddedTasks(value.tasks);
  const tasks = parseEmbeddedTemplateTasks(embeddedTasks, id);
  return {
    id,
    name: value.name,
    businessType: value.businessType,
    isActive: value.isActive !== false,
    taskCount: tasks.length,
    tasks,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Builds API service detail from validated input (avoids extra Firestore read after write). */
function buildServiceDetailFromInput(
  id: string,
  businessId: string,
  value: CreateBusinessServiceInput,
): BusinessServiceDetail {
  const embeddedTasks = buildEmbeddedTasks(value.tasks);
  const tasks = parseEmbeddedServiceTasks(embeddedTasks, id);
  return {
    id,
    businessId,
    templateId: value.source === "template" ? value.templateId ?? null : null,
    name: value.name,
    businessType: value.businessType,
    requiredSkill: value.requiredSkill,
    defaultDurationMin: value.defaultDurationMin,
    isActive: value.isActive !== false,
    imageUrl: value.imageUrl ?? null,
    taskCount: tasks.length,
    tasks,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Reads businessType from the businesses collection for trade-type filtering. */
export async function getBusinessTradeType(
  businessId: string,
): Promise<string | null> {
  const doc = await adminDb.collection(COLLECTIONS.BUSINESSES).doc(businessId).get();
  if (!doc.exists) return null;
  const businessType = doc.data()?.businessType;
  return typeof businessType === "string" ? businessType : null;
}

/**
 * Lists service templates, optionally filtered by active status and trade type.
 * Sorts by createdAt descending in memory to avoid composite Firestore indexes.
 */
export async function listServiceTemplates(options?: {
  activeOnly?: boolean;
  businessType?: string;
}): Promise<
  | { ok: true; templates: ServiceTemplateDetail[] }
  | { ok: false; error: string }
> {
  try {
    const snapshot = await adminDb.collection(COLLECTIONS.SERVICE_TEMPLATES).get();

    const docs = snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        if (options?.activeOnly && data?.isActive === false) return false;
        if (options?.businessType) {
          const templateType = data?.businessType ?? data?.category;
          if (templateType !== options.businessType) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aTime = toMillis(a.data()?.createdAt) ?? 0;
        const bTime = toMillis(b.data()?.createdAt) ?? 0;
        return bTime - aTime;
      });

    const templates = await Promise.all(docs.map((doc) => mapTemplateDoc(doc)));

    return { ok: true, templates };
  } catch (error) {
    console.error("listServiceTemplates failed:", error);
    return { ok: false, error: "Could not load service templates." };
  }
}

/** Fetches a single service template with its embedded tasks by ID. */
export async function getServiceTemplate(
  templateId: string,
): Promise<
  | { ok: true; template: ServiceTemplateDetail }
  | { ok: false; error: string }
> {
  try {
    const doc = await adminDb.collection(COLLECTIONS.SERVICE_TEMPLATES).doc(templateId).get();
    if (!doc.exists) {
      return { ok: false, error: "Service template not found." };
    }
    return { ok: true, template: await mapTemplateDoc(doc) };
  } catch (error) {
    console.error("getServiceTemplate failed:", error);
    return { ok: false, error: "Could not load service template." };
  }
}

/** Creates a service template with tasks embedded in the same document. */
export async function createServiceTemplate(
  raw: unknown,
): Promise<
  | { ok: true; templateId: string; template: ServiceTemplateDetail }
  | { ok: false; error: string }
> {
  const validated = validateServiceTemplateInput(raw);
  if (!validated.ok) return validated;

  try {
    const value = validated.value;
    const templateRef = adminDb.collection(COLLECTIONS.SERVICE_TEMPLATES).doc();
    const now = FieldValue.serverTimestamp();

    await templateRef.set({
      id: templateRef.id,
      name: value.name,
      businessType: value.businessType,
      isActive: value.isActive !== false,
      tasks: buildEmbeddedTasks(value.tasks),
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      templateId: templateRef.id,
      template: buildTemplateDetailFromInput(templateRef.id, value),
    };
  } catch (error) {
    console.error("createServiceTemplate failed:", error);
    return { ok: false, error: "Could not create service template." };
  }
}

/** Updates a template and replaces the embedded tasks array. */
export async function updateServiceTemplate(
  templateId: string,
  raw: unknown,
): Promise<
  | { ok: true; template: ServiceTemplateDetail }
  | { ok: false; error: string }
> {
  const validated = validateServiceTemplateInput(raw);
  if (!validated.ok) return validated;

  try {
    const templateRef = adminDb.collection(COLLECTIONS.SERVICE_TEMPLATES).doc(templateId);
    const existing = await templateRef.get();
    if (!existing.exists) {
      return { ok: false, error: "Service template not found." };
    }

    const value = validated.value;
    const existingData = existing.data() ?? {};
    const now = FieldValue.serverTimestamp();

    // Full document write drops legacy fields (category, requiredSkill, etc.).
    await templateRef.set({
      id: templateId,
      name: value.name,
      businessType: value.businessType,
      isActive: value.isActive !== false,
      tasks: buildEmbeddedTasks(value.tasks),
      createdAt: existingData.createdAt ?? now,
      updatedAt: now,
    });

    return {
      ok: true,
      template: buildTemplateDetailFromInput(templateId, value),
    };
  } catch (error) {
    console.error("updateServiceTemplate failed:", error);
    return { ok: false, error: "Could not update service template." };
  }
}

/** Deletes a service template document (tasks are embedded, no subcollection cleanup). */
export async function deleteServiceTemplate(
  templateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const templateRef = adminDb.collection(COLLECTIONS.SERVICE_TEMPLATES).doc(templateId);
    const existing = await templateRef.get();
    if (!existing.exists) {
      return { ok: false, error: "Service template not found." };
    }

    await templateRef.delete();
    return { ok: true };
  } catch (error) {
    console.error("deleteServiceTemplate failed:", error);
    return { ok: false, error: "Could not delete service template." };
  }
}

/** Lists all services for a business, newest first, with embedded tasks. */
export async function listBusinessServices(
  businessId: string,
): Promise<
  | { ok: true; services: BusinessServiceDetail[] }
  | { ok: false; error: string }
> {
  try {
    const snapshot = await adminDb
      .collection(COLLECTIONS.SERVICES)
      .where("businessId", "==", businessId)
      .get();

    const docs = snapshot.docs.sort((a, b) => {
      const aTime = toMillis(a.data()?.createdAt) ?? 0;
      const bTime = toMillis(b.data()?.createdAt) ?? 0;
      return bTime - aTime;
    });

    const services = await Promise.all(docs.map((doc) => mapServiceDoc(doc)));

    return { ok: true, services };
  } catch (error) {
    console.error("listBusinessServices failed:", error);
    return { ok: false, error: "Could not load services." };
  }
}

/** Fetches one business service; returns not found if businessId does not match. */
export async function getBusinessService(
  serviceId: string,
  businessId: string,
): Promise<
  | { ok: true; service: BusinessServiceDetail }
  | { ok: false; error: string }
> {
  try {
    const doc = await adminDb.collection(COLLECTIONS.SERVICES).doc(serviceId).get();
    if (!doc.exists) {
      return { ok: false, error: "Service not found." };
    }
    const data = doc.data();
    if (data?.businessId !== businessId) {
      return { ok: false, error: "Service not found." };
    }
    return { ok: true, service: await mapServiceDoc(doc) };
  } catch (error) {
    console.error("getBusinessService failed:", error);
    return { ok: false, error: "Could not load service." };
  }
}

/** Persists a new business service with tasks embedded in the same document. */
async function writeBusinessService(
  businessId: string,
  value: CreateBusinessServiceInput,
): Promise<
  | { ok: true; serviceId: string; service: BusinessServiceDetail }
  | { ok: false; error: string }
> {
  const serviceRef = adminDb.collection(COLLECTIONS.SERVICES).doc();
  const now = FieldValue.serverTimestamp();

  await serviceRef.set({
    id: serviceRef.id,
    businessId,
    templateId: value.source === "template" ? value.templateId ?? null : null,
    name: value.name,
    businessType: value.businessType,
    requiredSkill: value.requiredSkill,
    defaultDurationMin: value.defaultDurationMin,
    isActive: value.isActive !== false,
    imageUrl: value.imageUrl ?? null,
    tasks: buildEmbeddedTasks(value.tasks),
    createdAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    serviceId: serviceRef.id,
    service: buildServiceDetailFromInput(serviceRef.id, businessId, value),
  };
}

/**
 * Creates a business service from a template (with trade-type check) or custom data.
 * When sourced from a template, merges owner overrides with template defaults.
 */
export async function createBusinessService(
  businessId: string,
  raw: unknown,
): Promise<
  | { ok: true; serviceId: string; service: BusinessServiceDetail }
  | { ok: false; error: string }
> {
  const validated = validateCreateBusinessServiceInput(raw);
  if (!validated.ok) return validated;

  const value = validated.value;

  if (value.source === "template" && value.templateId) {
    const templateResult = await getServiceTemplate(value.templateId);
    if (!templateResult.ok) return templateResult;

    const template = templateResult.template;
    if (!template.isActive) {
      return { ok: false, error: "Selected template is not active." };
    }

    const ownerTradeType = await getBusinessTradeType(businessId);
    if (!ownerTradeType) {
      return { ok: false, error: "Could not verify your business trade type." };
    }
    if (template.businessType !== ownerTradeType) {
      return {
        ok: false,
        error: "This template is not available for your trade type.",
      };
    }

    const merged: CreateBusinessServiceInput = {
      source: "template",
      templateId: template.id,
      name: value.name || template.name,
      businessType: value.businessType || template.businessType,
      requiredSkill: value.requiredSkill || template.businessType,
      defaultDurationMin:
        value.defaultDurationMin || SERVICE_TEMPLATE_DEFAULTS.defaultDurationMin,
      isActive: value.isActive !== false,
      imageUrl: value.imageUrl ?? null,
      tasks:
        value.tasks.length > 0
          ? value.tasks
          : template.tasks.map((task) => ({
              title: task.title,
              description: task.description,
            })),
    };

    return writeBusinessService(businessId, merged);
  }

  return writeBusinessService(businessId, value);
}

/** Partially updates a business service; replaces embedded tasks when tasks array is sent. */
export async function updateBusinessService(
  serviceId: string,
  businessId: string,
  raw: unknown,
): Promise<
  | { ok: true; service: BusinessServiceDetail }
  | { ok: false; error: string }
> {
  const validated = validateUpdateBusinessServiceInput(raw);
  if (!validated.ok) return validated;

  try {
    const serviceRef = adminDb.collection(COLLECTIONS.SERVICES).doc(serviceId);
    const existing = await serviceRef.get();
    if (!existing.exists || existing.data()?.businessId !== businessId) {
      return { ok: false, error: "Service not found." };
    }

    const value = validated.value;
    const now = FieldValue.serverTimestamp();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (value.name !== undefined) updates.name = value.name;
    if (value.businessType !== undefined) {
      updates.businessType = value.businessType;
      updates.category = FieldValue.delete();
    }
    if (value.requiredSkill !== undefined) {
      updates.requiredSkill = value.requiredSkill;
    }
    if (value.defaultDurationMin !== undefined) {
      updates.defaultDurationMin = value.defaultDurationMin;
    }
    if (value.isActive !== undefined) updates.isActive = value.isActive;
    updates.needsReview = FieldValue.delete();
    if (value.imageUrl !== undefined) updates.imageUrl = value.imageUrl;
    if (value.tasks) {
      updates.tasks = buildEmbeddedTasks(value.tasks);
    }

    await serviceRef.update(updates);

    const updated = await getBusinessService(serviceId, businessId);
    if (!updated.ok) return updated;
    return { ok: true, service: updated.service };
  } catch (error) {
    console.error("updateBusinessService failed:", error);
    return { ok: false, error: "Could not update service." };
  }
}

/** Deletes a business service document (tasks are embedded). */
export async function deleteBusinessService(
  serviceId: string,
  businessId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const serviceRef = adminDb.collection(COLLECTIONS.SERVICES).doc(serviceId);
    const existing = await serviceRef.get();
    if (!existing.exists || existing.data()?.businessId !== businessId) {
      return { ok: false, error: "Service not found." };
    }

    await serviceRef.delete();
    return { ok: true };
  } catch (error) {
    console.error("deleteBusinessService failed:", error);
    return { ok: false, error: "Could not delete service." };
  }
}

export type { ServiceTemplateInput, CreateBusinessServiceInput, UpdateBusinessServiceInput };
