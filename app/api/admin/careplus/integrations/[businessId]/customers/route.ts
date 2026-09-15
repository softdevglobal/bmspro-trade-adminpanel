import { logAuditEvent } from "@/lib/audit/server";
import { CareplusClientError, fetchCareplusDirectory } from "@/lib/integrations/careplus/client";
import { enqueueCareplusDirectorySafe } from "@/lib/integrations/careplus/enqueue";
import {
  linkCustomersWithCareplusDirectory,
  listBusinessCustomers,
  listCareplusCustomerMappings,
  upsertCareplusCustomerMapping,
} from "@/lib/integrations/careplus/mapping";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { businessId } = await context.params;
  const [bmsCustomers, mappings] = await Promise.all([
    listBusinessCustomers(businessId),
    listCareplusCustomerMappings(businessId),
  ]);
  let careplus: Awaited<ReturnType<typeof fetchCareplusDirectory>> = [];
  let directoryError: string | undefined;
  try {
    careplus = await fetchCareplusDirectory({
      businessId,
      view: "participants",
    });
  } catch (error) {
    directoryError =
      error instanceof CareplusClientError || error instanceof Error
        ? error.message
        : "Could not load CarePlus participants.";
  }
  const customers = linkCustomersWithCareplusDirectory({
    customers: bmsCustomers,
    careplus,
    mappings,
    includeUnlinked: Boolean(directoryError),
  });
  return NextResponse.json({
    ok: true,
    customers,
    mappings,
    careplusCount: careplus.length,
    ...(directoryError ? { directoryError } : {}),
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { businessId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const bmsCustomerId =
    typeof record.bmsCustomerId === "string" ? record.bmsCustomerId.trim() : "";
  const careplusParticipantId =
    typeof record.careplusParticipantId === "string"
      ? record.careplusParticipantId.trim()
      : "";
  const bmsCustomerName =
    typeof record.bmsCustomerName === "string" ? record.bmsCustomerName.trim() : null;

  try {
    const mapping = await upsertCareplusCustomerMapping({
      businessId,
      bmsCustomerId,
      bmsCustomerName,
      careplusParticipantId,
      actorUid: auth.uid,
    });
    await logAuditEvent({
      businessId,
      category: "integration",
      action: "careplus.customer_mapped",
      actor: {
        uid: auth.uid,
        role: "super_admin",
        name: null,
        email: auth.email ?? null,
      },
      source: "admin_panel",
      summary: `CarePlus participant mapping saved for ${bmsCustomerId}`,
      targetId: mapping.id,
      metadata: { bmsCustomerId },
    });
    await enqueueCareplusDirectorySafe({
      businessId,
      eventType: "directory.participant",
      recordId: bmsCustomerId,
      record: {
        customerId: bmsCustomerId,
        careplusParticipantId,
        name: bmsCustomerName || "",
      },
    });
    return NextResponse.json({ ok: true, mapping });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save customer mapping.",
      },
      { status: 400 },
    );
  }
}
