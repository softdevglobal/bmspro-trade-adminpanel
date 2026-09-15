import { randomUUID } from "node:crypto";

import { enqueueCareplusCaptureSafe } from "@/lib/integrations/careplus/enqueue";
import { getCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import { listCareplusOutbox } from "@/lib/integrations/careplus/outbox";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CAPTURE_TYPES = [
  "incident.captured",
  "complaint.captured",
  "action.captured",
] as const;

export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const mapping = await getCareplusIntegration(auth.businessId);
  const outbox = await listCareplusOutbox(auth.businessId);
  return NextResponse.json({
    ok: true,
    connected: mapping?.status === "active",
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
      { ok: false, error: "Choose an incident, complaint or action." },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
  const staffId = typeof body.staffId === "string" ? body.staffId.trim() : auth.uid;
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const severity =
    typeof body.severity === "string" ? body.severity.trim() : "medium";
  if (title.length < 2) {
    return NextResponse.json({ ok: false, error: "Enter a title." }, { status: 400 });
  }
  if (eventType !== "action.captured" && description.length < 10) {
    return NextResponse.json(
      { ok: false, error: "Describe what happened in at least 10 characters." },
      { status: 400 },
    );
  }

  const recordId = randomUUID();
  const record =
    eventType === "incident.captured"
      ? {
          title,
          customerId,
          severity,
          description,
          immediateAction: typeof body.immediateAction === "string" ? body.immediateAction : "",
        }
      : eventType === "complaint.captured"
        ? { title, customerId, description }
        : {
            title,
            staffId,
            due: typeof body.due === "string" ? body.due : "",
            notes: description,
          };

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
