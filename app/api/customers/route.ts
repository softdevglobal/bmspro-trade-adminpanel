import { validateCustomerForm } from "@/lib/customer/form";
import { createBusinessCustomer } from "@/lib/customer/manage";
import { listBusinessCustomers } from "@/lib/customer/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { consumeRateLimits } from "@/lib/security/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const customers = await listBusinessCustomers(auth.businessId);
    return NextResponse.json({ ok: true, customers });
  } catch (error) {
    console.error("[customers] list failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not load customers." },
      { status: 500 },
    );
  }
}

/** POST { fullName, email, phone, company?, notes?, address?, sendInvite? } — adds one customer. */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateCustomerForm(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const allowed = await consumeRateLimits([
    { key: `customers:create:${auth.businessId}`, limit: 60, windowMs: 3_600_000 },
  ]);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Too many customers added. Try again later." }, { status: 429 });
  }

  try {
    const result = await createBusinessCustomer(
      { uid: auth.uid, email: auth.email ?? null, name: null, role: "owner", businessId: auth.businessId },
      parsed.value,
      { sendInvite: body?.sendInvite === true, channel: body?.via === "mcp" || body?.via === "voice" ? body.via : "manual" },
    );
    if (result.status === "DUPLICATE") {
      return NextResponse.json(
        {
          ok: false,
          code: "DUPLICATE",
          error: `${result.customer.fullName || "A customer"} already has this ${result.matchedOn}.`,
          matchedOn: result.matchedOn,
          customer: result.customer,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, customer: result.customer, inviteSent: result.inviteSent });
  } catch (error) {
    console.error("[customers] create failed:", error);
    return NextResponse.json({ ok: false, error: "Could not add the customer." }, { status: 500 });
  }
}
