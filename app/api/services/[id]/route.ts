/**
 * Single business service API (by service ID).
 *
 * GET    — Fetch one service owned by the caller's business.
 * PATCH  — Update service fields and/or replace its task checklist.
 * DELETE — Remove the service document (tasks are embedded).
 */

import {
  deleteBusinessService,
  getBusinessService,
  requireBusinessOwner,
  updateBusinessService,
} from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Loads a single service; 404 if missing or not owned by caller. */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const result = await getBusinessService(id, auth.businessId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({ ok: true, service: result.service });
}

/** Applies a partial update to an existing business service. */
export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireBusinessOwner(request);
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

  const result = await updateBusinessService(id, auth.businessId, body);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true, service: result.service });
}

/** Permanently deletes a business service and its tasks. */
export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const result = await deleteBusinessService(id, auth.businessId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
