/**
 * Business-owner services API.
 *
 * GET  — List all services for the authenticated owner's business.
 * POST — Create a service from a template or custom checklist data.
 */

import { logAuditEvent } from "@/lib/audit/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import {
  createBusinessService,
  listBusinessServices,
  requireBusinessOwner,
} from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Returns all services scoped to the caller's businessId. */
export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const result = await listBusinessServices(auth.businessId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({ ok: true, services: result.services });
}

/** Creates a new business service (template-based or fully custom). */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
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

  const result = await createBusinessService(auth.businessId, body);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "service",
    action: "service.created",
    actor: {
      uid: auth.uid,
      role: "owner",
      name: auth.email ?? null,
      email: auth.email ?? null,
    },
    source: "admin_panel",
    summary: `Service "${result.service.name}" created`,
    targetId: result.serviceId,
    targetLabel: result.service.name,
    metadata: {
      businessType: result.service.businessType,
      taskCount: result.service.taskCount,
      isActive: result.service.isActive,
    },
  });

  return NextResponse.json(result, { status: 201 });
}
