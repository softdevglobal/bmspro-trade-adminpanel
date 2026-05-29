import {
  authenticateCustomerRequest,
  getOrCreateCustomerProfile,
  updateCustomerProfile,
} from "@/lib/customer/server";
import { validateCustomerProfileInput } from "@/lib/customer/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateCustomerRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  const url = new URL(request.url);
  const bookingSlug = url.searchParams.get("bookingSlug")?.trim() || undefined;

  const profile = await getOrCreateCustomerProfile(auth.customer, {
    bookingSlug,
  });
  return NextResponse.json({ ok: true, profile });
}

export async function PATCH(request: Request) {
  const auth = await authenticateCustomerRequest(request);
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

  const parsed = validateCustomerProfileInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  const profile = await updateCustomerProfile(auth.customer, parsed.value);
  return NextResponse.json({ ok: true, profile });
}
