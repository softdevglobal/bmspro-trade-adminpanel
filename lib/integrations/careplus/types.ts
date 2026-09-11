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

export const CAREPLUS_EVENT_TYPES = [
  "job.completed",
  "directory.participant",
  "directory.staff",
  "activity.scheduled",
  "activity.completed",
  "activity.amended",
  "activity.cancelled",
  "incident.captured",
  "incident.amended",
  "complaint.captured",
  "complaint.amended",
  "action.captured",
  "evidence.attached",
] as const;
export type CareplusEventType = (typeof CAREPLUS_EVENT_TYPES)[number];

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

export type CareplusDirectoryPerson = {
  id: string;
  name: string;
  email?: string;
  bmsStaffId?: string;
  bmsCustomerId?: string;
};

export type CareplusLinkedStaffRow = {
  uid: string;
  fullName: string | null;
  email: string | null;
  role: string;
  careplusStaffId: string;
};

export type CareplusLinkedCustomerRow = {
  uid: string;
  fullName: string | null;
  email: string | null;
  careplusParticipantId: string;
};

export type CareplusCustomerMappingRecord = {
  id: string;
  businessId: string;
  bmsCustomerId: string;
  bmsCustomerName: string | null;
  careplusParticipantId: string;
  status: "active" | "revoked";
  verifiedBy: string | null;
  verifiedAt: number | null;
  mappingRevision: number;
};

export type CareplusReceiptCorrection = {
  field: string;
  message: string;
};

export type CareplusReceipt = {
  eventId: string;
  status: string;
  careplusRecordId: string;
  careplusResource: string;
  errors: string[];
  corrections: CareplusReceiptCorrection[];
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

export type CareplusRecordSource = {
  recordId: string;
  jobId?: string;
  customerId?: string;
  staffId?: string;
  revision: number;
};

export type CareplusRecordPayload = {
  eventId: string;
  eventType: CareplusEventType;
  businessId: string;
  occurredAt: string;
  source: CareplusRecordSource;
  record: Record<string, unknown>;
};

export type CareplusOutboxRecord = {
  eventId: string;
  businessId: string;
  eventType: CareplusEventType | string;
  jobId: string;
  payloadHash: string;
  rawBody: string;
  status: CareplusOutboxStatus;
  attempts: number;
  nextAttemptAt: number | null;
  lastStatus: number | null;
  lastErrorCode: string | null;
  processingStatus: string | null;
  careplusRecordId: string | null;
  careplusResource: string | null;
  corrections: CareplusReceiptCorrection[];
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
  customRequest: { title: string; description?: string } | null;
  customerId: string | null;
  assignedTo: { uid: string } | null;
  scheduledSlot?: { date: string; startTime?: string | null } | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  estimatedDurationMinutes?: number | null;
  visitStartedAt?: number | null;
  visitEndedAt?: number | null;
  ownerNote?: string | null;
  jobInstructionsDescription?: string | null;
};
