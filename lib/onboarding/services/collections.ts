/**
 * Firestore collection names and document shapes for the services module.
 *
 * Tasks are stored as an embedded `tasks` array on each service or template
 * document — not in separate subcollections.
 */

import type { FieldValue, Timestamp } from "firebase-admin/firestore";

/** Firestore collection path constants used by services/server.ts */
export const COLLECTIONS = {
  /** Super-admin catalog; includes embedded tasks[] */
  SERVICE_TEMPLATES: "service_templates",
  /** Business-owned services; includes embedded tasks[] */
  SERVICES: "services",
  /** Existing onboarding collection — read-only for businessType lookup */
  BUSINESSES: "businesses",
} as const;

/** @deprecated Legacy subcollection — only read for old documents without tasks[] */
export const LEGACY_COLLECTIONS = {
  SERVICE_TEMPLATE_TASKS: "service_template_tasks",
  SERVICE_TASKS: "service_tasks",
} as const;

/** Checklist item stored inside a service or template document */
export type EmbeddedTaskRecord = {
  id: string;
  title: string;
  description: string;
  isRequired: boolean;
  photoRequired: boolean;
  customerVisible: boolean;
  sortOrder: number;
};

/** Shared timestamp fields on every persisted document */
export type FirestoreTimestamps = {
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
};

/**
 * Document shape written to service_templates/{autoId}
 * Created by: createServiceTemplate() in server.ts
 */
export type ServiceTemplateDocument = {
  id: string;
  name: string;
  businessType: string;
  category: string;
  requiredSkill: string;
  defaultDurationMin: number;
  needsReview: boolean;
  isActive: boolean;
  imageUrl: string | null;
  tasks: EmbeddedTaskRecord[];
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
};

/**
 * Document shape written to services/{autoId}
 * FK: businessId → businesses.id, templateId → service_templates.id (optional)
 */
export type ServiceDocument = {
  id: string;
  businessId: string;
  templateId: string | null;
  name: string;
  category: string;
  requiredSkill: string;
  defaultDurationMin: number;
  needsReview: boolean;
  isActive: boolean;
  imageUrl: string | null;
  tasks: EmbeddedTaskRecord[];
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
};
