import { randomUUID } from "node:crypto";

import {
  buildComplaintRecord,
  buildIncidentRecord,
  buildRiskRecord,
  CAREPLUS_COMPLAINANT_RELATIONSHIPS,
  CAREPLUS_COMPLAINT_CATEGORIES,
  CAREPLUS_COMPLAINT_CHANNELS,
  CAREPLUS_COMPLAINT_RISK_LEVELS,
  CAREPLUS_INCIDENT_NOTIFIED_PARTIES,
  CAREPLUS_INCIDENT_SEVERITIES,
  CAREPLUS_INCIDENT_TYPES,
  CAREPLUS_RISK_CONSEQUENCES,
  CAREPLUS_RISK_LIKELIHOODS,
  capturedEventTypeFor,
  captureKindFromEventType,
  parseCaptureEnum,
  type CareplusCaptureEventType,
  type CareplusCaptureKind,
  type CareplusComplainantRelationship,
  type CareplusComplaintCategory,
  type CareplusComplaintRiskLevel,
  type CareplusIncidentNotifiedParty,
  type CareplusIncidentType,
  validateCaptureBasics,
} from "@/lib/integrations/careplus/capture-records";
import { enqueueCareplusCaptureSafe } from "@/lib/integrations/careplus/enqueue";
import {
  getCareplusIntegration,
  listBusinessStaffDirectory,
  listCareplusOperationsCustomers,
} from "@/lib/integrations/careplus/mapping";
import {
  deleteCareplusOutboxEvent,
  listCareplusOutbox,
  processCareplusOutbox,
  reconcileCareplusOutboxReceipts,
  retryCareplusOutboxEventForBusiness,
} from "@/lib/integrations/careplus/outbox";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OPERATIONAL_CAPTURE_TYPES = [
  "incident.captured",
  "complaint.captured",
  "risk.captured",
] as const satisfies readonly CareplusCaptureEventType[];

const OTHER_CAPTURE_TYPES = [
  "action.captured",
  "evidence.attached",
  "staff.credential.submitted",
] as const;

const CAPTURE_TYPES = [
  ...OPERATIONAL_CAPTURE_TYPES,
  ...OTHER_CAPTURE_TYPES,
] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildOperationalRecord(
  eventType: CareplusCaptureEventType,
  body: Record<string, unknown>,
  staffId: string,
): { record: Record<string, unknown>; customerId: string } {
  const kind = captureKindFromEventType(eventType);
  const title = asString(body.title);
  const description = asString(body.description);
  const anonymous = body.anonymous === true;
  const customerId = anonymous ? "" : asString(body.customerId);
  const date = asString(body.date) || todayIsoDate();

  if (kind === "incident") {
    const notifiedParties = Array.isArray(body.notifiedParties)
      ? body.notifiedParties.filter(
          (value): value is CareplusIncidentNotifiedParty =>
            typeof value === "string" &&
            (CAREPLUS_INCIDENT_NOTIFIED_PARTIES as readonly string[]).includes(
              value,
            ),
        )
      : [];
    const involvedStaffIds = Array.isArray(body.involvedStaffIds)
      ? body.involvedStaffIds
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const incidentTypeRaw = asString(body.incidentType);
    const incidentType = (
      CAREPLUS_INCIDENT_TYPES as readonly string[]
    ).includes(incidentTypeRaw)
      ? (incidentTypeRaw as CareplusIncidentType)
      : "";
    return {
      customerId,
      record: buildIncidentRecord({
        title,
        customerId,
        date,
        incidentTime: asString(body.incidentTime),
        awarenessAt: asString(body.awarenessAt),
        incidentType,
        severity: parseCaptureEnum(
          body.severity,
          CAREPLUS_INCIDENT_SEVERITIES,
          "medium",
        ),
        description,
        immediateAction: asString(body.immediateAction),
        location: asString(body.location),
        reporterNote: asString(body.reporterNote),
        witnesses: asString(body.witnesses) || asString(body.reporterNote),
        injuryDetails: asString(body.injuryDetails),
        escalationMade: asString(body.escalationMade),
        notifiedParties,
        involvedStaffIds,
      }),
    };
  }

  if (kind === "complaint") {
    const categoryRaw = asString(body.category);
    const category = (
      CAREPLUS_COMPLAINT_CATEGORIES as readonly string[]
    ).includes(categoryRaw)
      ? (categoryRaw as CareplusComplaintCategory)
      : "";
    const relationshipRaw = asString(body.complainantRelationship);
    const complainantRelationship = (
      CAREPLUS_COMPLAINANT_RELATIONSHIPS as readonly string[]
    ).includes(relationshipRaw)
      ? (relationshipRaw as CareplusComplainantRelationship)
      : "";
    const riskLevelRaw = asString(body.riskLevel);
    const riskLevel = (
      CAREPLUS_COMPLAINT_RISK_LEVELS as readonly string[]
    ).includes(riskLevelRaw)
      ? (riskLevelRaw as CareplusComplaintRiskLevel)
      : "";
    return {
      customerId,
      record: buildComplaintRecord({
        title,
        customerId,
        date,
        description,
        anonymous,
        channel: parseCaptureEnum(
          body.channel,
          CAREPLUS_COMPLAINT_CHANNELS,
          "in_person",
        ),
        category,
        requestedOutcome: asString(body.requestedOutcome),
        actionTaken: asString(body.actionTaken),
        ownerId: staffId,
        due: asString(body.due),
        safetyConcern:
          body.safetyConcern === true || body.safetyOrHarm === true,
        safetyOrHarm:
          body.safetyConcern === true || body.safetyOrHarm === true,
        riskLevel,
        riskNotes: asString(body.riskNotes),
        complainantName: asString(body.complainantName),
        complainantRelationship,
        complainantContact: asString(body.complainantContact),
        representativeName: asString(body.representativeName),
        representativeContact: asString(body.representativeContact),
        supportOffered: asString(body.supportOffered),
      }),
    };
  }

  return {
    customerId,
    record: buildRiskRecord({
      title,
      customerId,
      hazard: description || asString(body.hazard),
      likelihood: parseCaptureEnum(
        body.likelihood,
        CAREPLUS_RISK_LIKELIHOODS,
        "medium",
      ),
      consequence: parseCaptureEnum(
        body.consequence,
        CAREPLUS_RISK_CONSEQUENCES,
        "medium",
      ),
      existingControls: asString(body.existingControls),
      treatment: asString(body.treatment),
      siteOrAsset: asString(body.siteOrAsset),
      proposedOwner: asString(body.proposedOwner) || asString(body.reviewOwnerId) || staffId,
      reviewOwnerId: asString(body.reviewOwnerId) || asString(body.proposedOwner) || staffId,
      reviewDate: asString(body.reviewDate),
      status: "open",
    }),
  };
}

export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const mapping = await getCareplusIntegration(auth.businessId);
  const [initialOutbox, customers, staff] = await Promise.all([
    listCareplusOutbox(auth.businessId),
    listCareplusOperationsCustomers(auth.businessId).catch(() => []),
    listBusinessStaffDirectory(auth.businessId).catch(() => []),
  ]);
  await reconcileCareplusOutboxReceipts(initialOutbox).catch(() => undefined);
  const outbox = await listCareplusOutbox(auth.businessId);
  return NextResponse.json({
    ok: true,
    connected: mapping?.status === "active",
    paused: mapping?.status === "revoked",
    mappingStatus: mapping?.status ?? null,
    customers,
    staff,
    outbox,
  });
}

export async function POST(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const eventType = CAPTURE_TYPES.find((value) => value === body.eventType);
  if (!eventType) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Choose an incident, complaint, risk, action, evidence or credential record.",
      },
      { status: 400 },
    );
  }

  const title = asString(body.title);
  const description = asString(body.description);
  const staffId = asString(body.staffId) || auth.uid;
  const jobId = asString(body.jobId);
  const providedRecordId = asString(body.recordId);

  const isOperational = (
    OPERATIONAL_CAPTURE_TYPES as readonly string[]
  ).includes(eventType);

  if (isOperational) {
    const captureType = eventType as CareplusCaptureEventType;
    const kind = captureKindFromEventType(captureType) as CareplusCaptureKind;
    const basicsError = validateCaptureBasics({
      title,
      description: description || asString(body.hazard),
      date: asString(body.date),
      kind,
    });
    if (basicsError) {
      return NextResponse.json({ ok: false, error: basicsError }, { status: 400 });
    }

    const recordId = providedRecordId || randomUUID();
    const resolvedType = capturedEventTypeFor(kind);
    const { record, customerId } = buildOperationalRecord(
      resolvedType,
      body,
      staffId,
    );

    try {
      const queued = await enqueueCareplusCaptureSafe({
        businessId: auth.businessId,
        eventType: resolvedType,
        recordId,
        customerId,
        staffId,
        jobId,
        record,
      });
      let deliveryError: string | null = null;
      if (queued === "failed" || queued === "retry") {
        const eventId = `bms-${recordId}-${resolvedType}-v1`;
        const rows = await listCareplusOutbox(auth.businessId);
        const row = rows.find((item) => item.eventId === eventId);
        deliveryError = row?.lastErrorCode ?? null;
      }
      return NextResponse.json({
        ok: true,
        queued,
        recordId,
        eventType: resolvedType,
        deliveryError,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not send the CarePlus record.";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  const customerId = asString(body.customerId);
  const anonymous = body.anonymous === true;
  const severity = asString(body.severity) || "medium";
  if (
    eventType !== "action.captured" &&
    eventType !== "evidence.attached" &&
    eventType !== "staff.credential.submitted" &&
    description.length < 10
  ) {
    return NextResponse.json(
      { ok: false, error: "Describe what happened in at least 10 characters." },
      { status: 400 },
    );
  }
  if (title.length < 2) {
    return NextResponse.json({ ok: false, error: "Enter a title." }, { status: 400 });
  }

  if (eventType === "evidence.attached") {
    const fileUrl = asString(body.fileUrl);
    const sha256 = asString(body.sha256);
    const byteSize = typeof body.byteSize === "number" ? body.byteSize : 0;
    if (!fileUrl.startsWith("https://") || !/^[a-f0-9]{64}$/i.test(sha256) || byteSize < 1) {
      return NextResponse.json(
        { ok: false, error: "Upload a file first. A URL alone is not enough." },
        { status: 400 },
      );
    }
  }

  const recordId = providedRecordId || randomUUID();
  const record =
    eventType === "evidence.attached"
      ? {
          title,
          notes: description,
          fileUrl: asString(body.fileUrl),
          sha256: asString(body.sha256),
          byteSize: typeof body.byteSize === "number" ? body.byteSize : 0,
          filename: asString(body.filename),
          category: asString(body.category) || "Audit evidence",
        }
      : eventType === "staff.credential.submitted"
        ? {
            staffId,
            type: asString(body.credentialType) || "Training",
            name: title,
            issuer: asString(body.issuer),
            reference: asString(body.reference),
            expiry: asString(body.expiry),
            roleScope: asString(body.roleScope),
            notes: description,
            claimedStatus: asString(body.claimedStatus) || "pending",
          }
        : {
            title,
            staffId,
            due: asString(body.due),
            notes: description,
            sourceType: asString(body.sourceType),
            sourceId: asString(body.sourceRecordId),
            priority: asString(body.priority) || "normal",
          };

  if (eventType === "staff.credential.submitted" && staffId) {
    try {
      await adminDb.collection("users").doc(staffId).update({
        careplusCredentials: FieldValue.arrayUnion({
          id: recordId,
          type: record.type,
          name: title,
          issuer: record.issuer,
          reference: record.reference,
          expiry: record.expiry,
          claimedStatus: record.claimedStatus,
          submittedAt: Date.now(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("[careplus] could not persist staff credential locally", error);
    }
  }

  try {
    const queued = await enqueueCareplusCaptureSafe({
      businessId: auth.businessId,
      eventType,
      recordId,
      customerId: anonymous ? "" : customerId,
      staffId,
      jobId,
      record,
    });
    return NextResponse.json({ ok: true, queued, recordId });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not send the CarePlus record." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const action = asString(body.action);
  const eventId = asString(body.eventId);
  if (action !== "retry" || !eventId) {
    return NextResponse.json(
      { ok: false, error: "Choose a delivery to send again." },
      { status: 400 },
    );
  }

  try {
    const outbox = await retryCareplusOutboxEventForBusiness(
      eventId,
      auth.businessId,
    );
    const result = await processCareplusOutbox({
      eventId: outbox.eventId,
      businessId: auth.businessId,
      ignoreBackoff: true,
    });
    return NextResponse.json({ ok: true, outbox, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not send the record again.";
    const status = message === "Record not found." ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const eventId =
    new URL(request.url).searchParams.get("eventId")?.trim() || "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "Choose a record to delete." },
      { status: 400 },
    );
  }

  try {
    await deleteCareplusOutboxEvent(eventId, auth.businessId);
    return NextResponse.json({ ok: true, eventId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not delete the record.";
    const status = message === "Record not found." ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
