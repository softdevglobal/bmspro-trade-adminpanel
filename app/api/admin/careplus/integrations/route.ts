import { logAuditEvent } from "@/lib/audit/server";
import {
  listCareplusIntegrations,
  upsertCareplusIntegration,
} from "@/lib/integrations/careplus/mapping";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const integrations = await listCareplusIntegrations();
    return NextResponse.json({ ok: true, integrations });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not load CarePlus mappings." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

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
  const businessId =
    typeof record.businessId === "string" ? record.businessId.trim() : "";
  const careplusProviderId =
    typeof record.careplusProviderId === "string"
      ? record.careplusProviderId.trim()
      : "";

  try {
    const integration = await upsertCareplusIntegration({
      businessId,
      careplusProviderId,
      actorUid: auth.uid,
      actorEmail: auth.email,
    });
    await logAuditEvent({
      businessId,
      category: "integration",
      action: "careplus.mapping_saved",
      actor: {
        uid: auth.uid,
        role: "super_admin",
        name: null,
        email: auth.email ?? null,
      },
      source: "admin_panel",
      summary: `CarePlus mapping saved for ${businessId}`,
      targetId: businessId,
      targetLabel: integration.careplusProviderId,
      metadata: {
        careplusProviderId,
        mappingRevision: integration.mappingRevision,
      },
    });
    return NextResponse.json({ ok: true, integration });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save CarePlus mapping.",
      },
      { status: 400 },
    );
  }
}
