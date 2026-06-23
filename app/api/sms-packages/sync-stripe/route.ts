import { requireSuperAdmin } from "@/lib/onboarding/server";
import { syncSmsPackageToStripe } from "@/lib/sms-packages/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Super admin — create or refresh Stripe product/price for an SMS package. */
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

  const packageId =
    body &&
    typeof body === "object" &&
    typeof (body as { id?: unknown }).id === "string"
      ? (body as { id: string }).id.trim()
      : "";

  if (!packageId) {
    return NextResponse.json(
      { ok: false, error: "SMS package id is required." },
      { status: 400 },
    );
  }

  try {
    const pkg = await syncSmsPackageToStripe(packageId);
    if (!pkg) {
      return NextResponse.json(
        { ok: false, error: "SMS package not found." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, package: pkg });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not sync SMS package to Stripe.",
      },
      { status: 400 },
    );
  }
}
