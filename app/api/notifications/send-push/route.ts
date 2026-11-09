import { verifyAccountIdToken } from "@/lib/auth/account-access";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false as const, status: 401, error: "Missing authorization header." };
  }
  try {
    await verifyAccountIdToken(match[1]);
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid or expired session." };
  }
}

/**
 * Retired client-controlled sender. Notifications must originate from an
 * authorized domain operation that resolves recipients and content server-side.
 * Keep an explicit response for older mobile clients using this URL.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  return NextResponse.json(
    {
      success: false,
      code: "CLIENT_PUSH_RETIRED",
      error: "Direct push requests are no longer supported.",
    },
    { status: 410 },
  );
}
