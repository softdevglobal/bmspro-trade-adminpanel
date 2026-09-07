import { logAuditEvent } from "@/lib/audit/server";
import {
  listBusinessStaffDirectory,
  listCareplusStaffMappings,
  upsertCareplusStaffMapping,
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
  const [staff, mappings] = await Promise.all([
    listBusinessStaffDirectory(businessId),
    listCareplusStaffMappings(businessId),
  ]);
  return NextResponse.json({ ok: true, staff, mappings });
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
  const bmsStaffUid =
    typeof record.bmsStaffUid === "string" ? record.bmsStaffUid.trim() : "";
  const careplusStaffId =
    typeof record.careplusStaffId === "string"
      ? record.careplusStaffId.trim()
      : "";
  const bmsStaffName =
    typeof record.bmsStaffName === "string" ? record.bmsStaffName.trim() : null;

  try {
    const mapping = await upsertCareplusStaffMapping({
      businessId,
      bmsStaffUid,
      bmsStaffName,
      careplusStaffId,
      actorUid: auth.uid,
    });
    await logAuditEvent({
      businessId,
      category: "integration",
      action: "careplus.staff_mapped",
      actor: {
        uid: auth.uid,
        role: "super_admin",
        name: null,
        email: auth.email ?? null,
      },
      source: "admin_panel",
      summary: `CarePlus staff mapping saved for ${bmsStaffUid}`,
      targetId: mapping.id,
      metadata: { bmsStaffUid },
    });
    return NextResponse.json({ ok: true, mapping });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save staff mapping.",
      },
      { status: 400 },
    );
  }
}
