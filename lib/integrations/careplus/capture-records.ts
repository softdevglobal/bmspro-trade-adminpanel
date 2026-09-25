/**
 * Pure builders for CarePlus incident / complaint / risk capture envelopes.
 * Kept free of Firebase so unit tests can exercise create and amend shapes.
 */

export const CAREPLUS_CAPTURE_KINDS = [
  "incident",
  "complaint",
  "risk",
] as const;
export type CareplusCaptureKind = (typeof CAREPLUS_CAPTURE_KINDS)[number];

export const CAREPLUS_INCIDENT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type CareplusIncidentSeverity =
  (typeof CAREPLUS_INCIDENT_SEVERITIES)[number];

export const CAREPLUS_COMPLAINT_CHANNELS = [
  "in_person",
  "phone",
  "email",
  "written",
  "other",
] as const;
export type CareplusComplaintChannel =
  (typeof CAREPLUS_COMPLAINT_CHANNELS)[number];

export const CAREPLUS_RISK_LIKELIHOODS = ["low", "medium", "high"] as const;
export type CareplusRiskLikelihood =
  (typeof CAREPLUS_RISK_LIKELIHOODS)[number];

export const CAREPLUS_RISK_CONSEQUENCES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type CareplusRiskConsequence =
  (typeof CAREPLUS_RISK_CONSEQUENCES)[number];

export const CAREPLUS_COMPLAINT_CATEGORIES = [
  "Service delivery",
  "Staff conduct",
  "Communication",
  "Safety",
  "Billing or fees",
  "Privacy",
  "Other",
] as const;
export type CareplusComplaintCategory =
  (typeof CAREPLUS_COMPLAINT_CATEGORIES)[number];

export const CAREPLUS_COMPLAINT_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type CareplusComplaintRiskLevel =
  (typeof CAREPLUS_COMPLAINT_RISK_LEVELS)[number];

export const CAREPLUS_COMPLAINANT_RELATIONSHIPS = [
  "Participant",
  "Family member",
  "Carer or guardian",
  "Advocate",
  "Staff member",
  "Other",
] as const;
export type CareplusComplainantRelationship =
  (typeof CAREPLUS_COMPLAINANT_RELATIONSHIPS)[number];

export const CAREPLUS_RISK_STATUSES = ["open", "assessed", "closed"] as const;
export type CareplusRiskStatus = (typeof CAREPLUS_RISK_STATUSES)[number];

export type CareplusCaptureEventType =
  | "incident.captured"
  | "incident.amended"
  | "complaint.captured"
  | "complaint.amended"
  | "risk.captured"
  | "risk.amended";

export type CareplusCaptureEnvelope = {
  eventId: string;
  eventType: CareplusCaptureEventType;
  businessId: string;
  occurredAt: string;
  source: {
    recordId: string;
    customerId?: string;
    staffId?: string;
    jobId?: string;
    revision: number;
  };
  record: Record<string, unknown>;
};

export const CAREPLUS_INCIDENT_TYPES = [
  "Injury or illness",
  "Fall",
  "Medication",
  "Behaviour of concern",
  "Abuse or neglect allegation",
  "Restrictive practice",
  "Missing person",
  "Property damage or loss",
  "Near miss",
  "Other",
] as const;
export type CareplusIncidentType = (typeof CAREPLUS_INCIDENT_TYPES)[number];

export const CAREPLUS_INCIDENT_NOTIFIED_PARTIES = [
  "Police",
  "Ambulance or emergency services",
  "Family, guardian or nominee",
  "Doctor or health service",
  "Support coordinator",
  "Other authority",
] as const;
export type CareplusIncidentNotifiedParty =
  (typeof CAREPLUS_INCIDENT_NOTIFIED_PARTIES)[number];

export type CareplusIncidentFields = {
  title: string;
  customerId?: string;
  date: string;
  incidentTime?: string;
  awarenessAt?: string;
  incidentType?: CareplusIncidentType | "";
  severity: CareplusIncidentSeverity;
  description: string;
  immediateAction?: string;
  location?: string;
  reporterNote?: string;
  witnesses?: string;
  injuryDetails?: string;
  escalationMade?: string;
  notifiedParties?: CareplusIncidentNotifiedParty[];
  involvedStaffIds?: string[];
};

export type CareplusComplaintFields = {
  title: string;
  customerId?: string;
  date: string;
  description: string;
  anonymous: boolean;
  channel: CareplusComplaintChannel;
  category?: CareplusComplaintCategory | "";
  requestedOutcome?: string;
  actionTaken?: string;
  ownerId?: string;
  due?: string;
  safetyConcern?: boolean;
  safetyOrHarm?: boolean;
  riskLevel?: CareplusComplaintRiskLevel | "";
  riskNotes?: string;
  complainantName?: string;
  complainantRelationship?: CareplusComplainantRelationship | "";
  complainantContact?: string;
  representativeName?: string;
  representativeContact?: string;
  supportOffered?: string;
};

export type CareplusRiskFields = {
  title: string;
  customerId?: string;
  hazard: string;
  likelihood: CareplusRiskLikelihood;
  consequence: CareplusRiskConsequence;
  existingControls?: string;
  treatment?: string;
  siteOrAsset?: string;
  proposedOwner?: string;
  reviewOwnerId?: string;
  reviewDate?: string;
  status?: CareplusRiskStatus;
};

function asTrimmed(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function omitEmpty<T extends Record<string, unknown>>(
  value: T,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) return false;
      if (typeof entry === "string") return entry.length > 0;
      return true;
    }),
  );
}

export function captureKindFromEventType(
  eventType: CareplusCaptureEventType,
): CareplusCaptureKind {
  if (eventType.startsWith("incident.")) return "incident";
  if (eventType.startsWith("complaint.")) return "complaint";
  return "risk";
}

export function isAmendCaptureEvent(
  eventType: CareplusCaptureEventType,
): boolean {
  return eventType.endsWith(".amended");
}

export function capturedEventTypeFor(
  kind: CareplusCaptureKind,
): Extract<
  CareplusCaptureEventType,
  "incident.captured" | "complaint.captured" | "risk.captured"
> {
  return `${kind}.captured` as Extract<
    CareplusCaptureEventType,
    "incident.captured" | "complaint.captured" | "risk.captured"
  >;
}

export function amendedEventTypeFor(
  kind: CareplusCaptureKind,
): Extract<
  CareplusCaptureEventType,
  "incident.amended" | "complaint.amended" | "risk.amended"
> {
  return `${kind}.amended` as Extract<
    CareplusCaptureEventType,
    "incident.amended" | "complaint.amended" | "risk.amended"
  >;
}

export function nextCaptureRevision(current: number | null | undefined): number {
  if (typeof current === "number" && Number.isInteger(current) && current > 0) {
    return current + 1;
  }
  return 1;
}

/**
 * Stable event ids:
 * - create: bms-{recordId}-{kind}.captured-v1
 * - amend:  bms-{recordId}-{kind}.amended-r{revision}
 */
export function buildCaptureEventId(
  recordId: string,
  eventType: CareplusCaptureEventType,
  revision: number,
): string {
  const id = asTrimmed(recordId);
  if (!id) throw new Error("recordId is required.");
  if (isAmendCaptureEvent(eventType)) {
    return `bms-${id}-${eventType}-r${revision}`;
  }
  return `bms-${id}-${eventType}-v1`;
}

export function buildIncidentRecord(
  fields: CareplusIncidentFields,
): Record<string, unknown> {
  const notifiedParties = (fields.notifiedParties ?? []).filter((value) =>
    (CAREPLUS_INCIDENT_NOTIFIED_PARTIES as readonly string[]).includes(value),
  );
  const involvedStaffIds = (fields.involvedStaffIds ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const witnesses = asTrimmed(fields.witnesses) || asTrimmed(fields.reporterNote);
  return omitEmpty({
    title: asTrimmed(fields.title),
    customerId: asTrimmed(fields.customerId),
    date: asTrimmed(fields.date),
    incidentTime: asTrimmed(fields.incidentTime),
    awarenessAt: asTrimmed(fields.awarenessAt),
    incidentType: asTrimmed(fields.incidentType),
    severity: fields.severity,
    description: asTrimmed(fields.description),
    immediateAction: asTrimmed(fields.immediateAction),
    location: asTrimmed(fields.location),
    reporterNote: asTrimmed(fields.reporterNote),
    witnesses,
    injuryDetails: asTrimmed(fields.injuryDetails),
    escalationMade: asTrimmed(fields.escalationMade),
    ...(notifiedParties.length ? { notifiedParties } : {}),
    ...(involvedStaffIds.length ? { involvedStaffIds } : {}),
  });
}

export function buildComplaintRecord(
  fields: CareplusComplaintFields,
): Record<string, unknown> {
  const anonymous = fields.anonymous === true;
  const safetyConcern = fields.safetyConcern === true || fields.safetyOrHarm === true;
  return omitEmpty({
    title: asTrimmed(fields.title),
    customerId: anonymous ? "" : asTrimmed(fields.customerId),
    date: asTrimmed(fields.date),
    description: asTrimmed(fields.description),
    anonymous,
    channel: fields.channel,
    category: asTrimmed(fields.category),
    requestedOutcome: asTrimmed(fields.requestedOutcome),
    actionTaken: asTrimmed(fields.actionTaken),
    ownerId: asTrimmed(fields.ownerId),
    due: asTrimmed(fields.due),
    ...(safetyConcern ? { safetyConcern: true, safetyOrHarm: true } : {}),
    riskLevel: asTrimmed(fields.riskLevel),
    riskNotes: asTrimmed(fields.riskNotes),
    complainantName: anonymous ? "" : asTrimmed(fields.complainantName),
    complainantRelationship: anonymous
      ? ""
      : asTrimmed(fields.complainantRelationship),
    complainantContact: anonymous ? "" : asTrimmed(fields.complainantContact),
    representativeName: asTrimmed(fields.representativeName),
    representativeContact: asTrimmed(fields.representativeContact),
    supportOffered: asTrimmed(fields.supportOffered),
  });
}

export function buildRiskRecord(
  fields: CareplusRiskFields,
): Record<string, unknown> {
  const reviewOwner =
    asTrimmed(fields.reviewOwnerId) || asTrimmed(fields.proposedOwner);
  return omitEmpty({
    title: asTrimmed(fields.title),
    customerId: asTrimmed(fields.customerId),
    hazard: asTrimmed(fields.hazard),
    likelihood: fields.likelihood,
    consequence: fields.consequence,
    existingControls: asTrimmed(fields.existingControls),
    treatment: asTrimmed(fields.treatment),
    siteOrAsset: asTrimmed(fields.siteOrAsset),
    proposedOwner: reviewOwner,
    reviewOwnerId: reviewOwner,
    reviewDate: asTrimmed(fields.reviewDate),
    status: fields.status || "open",
  });
}

export function buildCaptureEnvelope(input: {
  businessId: string;
  recordId: string;
  eventType: CareplusCaptureEventType;
  revision: number;
  occurredAt?: string;
  customerId?: string;
  staffId?: string;
  jobId?: string;
  record: Record<string, unknown>;
}): CareplusCaptureEnvelope {
  const businessId = asTrimmed(input.businessId);
  const recordId = asTrimmed(input.recordId);
  if (!businessId) throw new Error("businessId is required.");
  if (!recordId) throw new Error("recordId is required.");
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error("revision must be a positive integer.");
  }

  const customerId = asTrimmed(input.customerId);
  const staffId = asTrimmed(input.staffId);
  const jobId = asTrimmed(input.jobId);
  const anonymous = input.record.anonymous === true;

  return {
    eventId: buildCaptureEventId(recordId, input.eventType, input.revision),
    eventType: input.eventType,
    businessId,
    occurredAt: input.occurredAt?.trim() || new Date().toISOString(),
    source: omitEmpty({
      recordId,
      customerId: anonymous ? "" : customerId,
      staffId,
      jobId,
      revision: input.revision,
    }) as CareplusCaptureEnvelope["source"],
    record: input.record,
  };
}

export function parseCaptureEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  return fallback;
}

export function validateCaptureBasics(input: {
  title: string;
  description: string;
  date?: string;
  kind: CareplusCaptureKind;
}): string | null {
  if (asTrimmed(input.title).length < 2) return "Enter a title.";
  if (asTrimmed(input.description).length < 10) {
    return input.kind === "risk"
      ? "Describe the hazard in at least 10 characters."
      : "Describe what happened in at least 10 characters.";
  }
  if (input.kind !== "risk" && !asTrimmed(input.date)) {
    return "Enter the date.";
  }
  return null;
}
