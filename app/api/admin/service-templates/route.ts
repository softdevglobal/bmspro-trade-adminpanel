/**
 * Super-admin service template catalog API.
 *
 * GET  — List all service templates (including inactive).
 * POST — Create a new template with tasks and trade type.
 */

import {
  createServiceTemplate,
  listServiceTemplates,
  requireSuperAdmin,
} from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Returns the full template catalog for super admin management. */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const result = await listServiceTemplates();
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: result.templates });
}

/** Creates a new global service template with checklist tasks. */
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

  const result = await createServiceTemplate(body);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
