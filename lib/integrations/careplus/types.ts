export const CAREPLUS_INTEGRATION_STATUSES = [
  "active",
  "revoked",
] as const;
export type CareplusIntegrationStatus =
  (typeof CAREPLUS_INTEGRATION_STATUSES)[number];

export const CAREPLUS_OUTBOX_STATUSES = [
  "pending",
  "retry",
  "sent",
  "failed",
] as const;
export type CareplusOutboxStatus = (typeof CAREPLUS_OUTBOX_STATUSES)[number];

export const CAREPLUS_LEARNING_VIEWS = [
  "catalogue",
  "learners",
  "activity",
] as const;
export type CareplusLearningView = (typeof CAREPLUS_LEARNING_VIEWS)[number];

export type CareplusIntegrationRecord = {
  businessId: string;
  businessName: string | null;
  careplusProviderId: string;
  status: CareplusIntegrationStatus;
  mappingRevision: number;
  verifiedBy: string | null;
  verifiedAt: number | null;
  revokedAt: number | null;
  lastEventStatus: string | null;
  lastEventAt: number | null;
  lastLearningAt: number | null;
  lastErrorCode: string | null;
  secretConfigured: boolean;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CareplusStaffMappingRecord = {
  id: string;
  businessId: string;
  bmsStaffUid: string;
  bmsStaffName: string | null;
  careplusStaffId: string;
  status: "active" | "revoked";
  verifiedBy: string | null;
  verifiedAt: number | null;
  mappingRevision: number;
};

export type CareplusJobCompletedPayload = {
  eventId: string;
  eventType: "job.completed";
  businessId: string;
  jobId: string;
  title: string;
  occurredAt: string;
  customerId?: string;
  staffId?: string;
};

export type CareplusOutboxRecord = {
  eventId: string;
  businessId: string;
  eventType: "job.completed";
  jobId: string;
  payloadHash: string;
  rawBody: string;
  status: CareplusOutboxStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastStatus: number | null;
  lastErrorCode: string | null;
  createdAt: number | null;
  sentAt: number | null;
};

export type CareplusLearningResult = {
  status: number;
  body: unknown;
  nextCursor: string | null;
};

export type CareplusEnqueueInput = {
  id: string;
  businessId: string;
  bookingCode: string | null;
  serviceName: string | null;
  customRequest: { title: string } | null;
  customerId: string | null;
  assignedTo: { uid: string } | null;
};
