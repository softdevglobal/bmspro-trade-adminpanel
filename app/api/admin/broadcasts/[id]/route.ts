import { requireSuperAdmin } from "@/lib/onboarding/server";
import { deleteBroadcast, setBroadcastActive } from "@/lib/broadcasts/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Toggle a broadcast's active flag (show/recall). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  if (typeof payload.active !== "boolean") {
    return NextResponse.json({ ok: false, error: "`active` must be a boolean." }, { status: 400 });
  }

  const ok = await setBroadcastActive(id, payload.active);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;
  const ok = await deleteBroadcast(id);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Message not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
