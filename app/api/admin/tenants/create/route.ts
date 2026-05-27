import { createTenantFromPayload, requireSuperAdmin } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const result = await createTenantFromPayload(
    body as Record<string, unknown>,
    {
      source: "super_admin_create",
      status: "active",
      createdByUid: auth.uid,
      createdByEmail: auth.email ?? null,
    }
  );

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
