import { allowResetCodeRequest } from "@/lib/auth/reset-codes";
import { registerSelfSignupTenant } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  if (!(await allowResetCodeRequest("signup", String((body as Record<string, unknown>).accountEmail ?? ""), request))) {
    return NextResponse.json({ ok: false, error: "Please wait before registering again." }, { status: 429 });
  }
  const result = await registerSelfSignupTenant(
    body as Record<string, unknown>
  );

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result, { status: 201 });
}
