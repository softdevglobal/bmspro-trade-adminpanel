/**
 * Super-admin single service template API (by template ID).
 *
 * GET    — Fetch one template with tasks.
 * PATCH  — Update template and replace tasks.
 * DELETE — Remove the template document (tasks are embedded).
 */

import {
  deleteServiceTemplate,
  getServiceTemplate,
  requireSuperAdmin,
  updateServiceTemplate,
} from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Loads a single service template by ID. */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const result = await getServiceTemplate(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({ ok: true, template: result.template });
}

/** Updates an existing service template and its task checklist. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const result = await updateServiceTemplate(id, body);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true, template: result.template });
}

/** Deletes a service template and all linked template tasks. */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const result = await deleteServiceTemplate(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
