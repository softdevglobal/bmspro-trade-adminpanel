import { logAuditEvent } from "@/lib/audit/server";
import {
  getCareplusIntegration,
  revokeCareplusIntegration,
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
  const integration = await getCareplusIntegration(businessId);
  if (!integration) {
    return NextResponse.json(
      { ok: false, error: "CarePlus mapping not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, integration });
}

export async function PATCH(
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

  const action =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).action
      : null;
  if (action !== "revoke") {
    return NextResponse.json(
      { ok: false, error: "Unsupported action." },
      { status: 400 },
    );
  }

  try {
    const integration = await revokeCareplusIntegration(businessId);
    await logAuditEvent({
      businessId,
      category: "integration",
      action: "careplus.mapping_revoked",
      actor: {
        uid: auth.uid,
        role: "super_admin",
        name: null,
        email: auth.email ?? null,
      },
      source: "admin_panel",
      summary: `CarePlus mapping revoked for ${businessId}`,
      targetId: businessId,
      targetLabel: integration.careplusProviderId,
    });
    return NextResponse.json({ ok: true, integration });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not revoke CarePlus mapping.",
      },
      { status: 400 },
    );
  }
}
