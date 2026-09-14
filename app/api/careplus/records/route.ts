import { randomUUID } from "node:crypto";

import { enqueueCareplusCaptureSafe } from "@/lib/integrations/careplus/enqueue";
import {
  getCareplusIntegration,
  listBusinessStaffDirectory,
  listCareplusOperationsCustomers,
} from "@/lib/integrations/careplus/mapping";
import { listCareplusOutbox } from "@/lib/integrations/careplus/outbox";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CAPTURE_TYPES = [
  "incident.captured",
  "complaint.captured",
  "risk.captured",
  "action.captured",
  "evidence.attached",
  "staff.credential.submitted",
] as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  const [outbox, customers, staff] = await Promise.all([
    listCareplusOutbox(auth.businessId),
    listCareplusOperationsCustomers(auth.businessId).catch(() => []),
    listBusinessStaffDirectory(auth.businessId).catch(() => []),
  ]);
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

  const mapping = await getCareplusIntegration(auth.businessId);
  if (!mapping || mapping.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "CarePlus is not connected for this business." },
      { status: 409 },
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
        error: "Choose an incident, complaint, risk, action, evidence or credential record.",
      },
      { status: 400 },
    );
  }

  const title = asString(body.title);
  const description = asString(body.description);
  const customerId = asString(body.customerId);
  const staffId = asString(body.staffId) || auth.uid;
  const jobId = asString(body.jobId);
  const severity = asString(body.severity) || "medium";
  const anonymous = body.anonymous === true;
  if (title.length < 2) {
    return NextResponse.json({ ok: false, error: "Enter a title." }, { status: 400 });
  }
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

  const recordId = randomUUID();
  const record =
    eventType === "incident.captured"
      ? {
          title,
          customerId,
          severity,
          description,
          immediateAction: asString(body.immediateAction),
          awarenessAt: asString(body.awarenessAt),
          location: asString(body.location),
          reporterNote: asString(body.reporterNote),
          escalationMade: asString(body.escalationMade),
        }
      : eventType === "complaint.captured"
        ? {
            title,
            customerId,
            description,
            anonymous,
            channel: asString(body.channel) || "in_person",
            requestedOutcome: asString(body.requestedOutcome),
            actionTaken: asString(body.actionTaken),
            ownerId: staffId,
            due: asString(body.due),
          }
        : eventType === "risk.captured"
          ? {
              title,
              customerId,
              hazard: description,
              likelihood: asString(body.likelihood) || "medium",
              consequence: asString(body.consequence) || "medium",
              existingControls: asString(body.existingControls),
              siteOrAsset: asString(body.siteOrAsset),
              proposedOwner: asString(body.proposedOwner),
              reviewDate: asString(body.reviewDate),
              treatment: asString(body.treatment),
            }
          : eventType === "evidence.attached"
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
      customerId,
      staffId,
      jobId,
      record,
    });
    return NextResponse.json({ ok: true, queued, recordId });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not queue the CarePlus record." },
      { status: 500 },
    );
  }
}
