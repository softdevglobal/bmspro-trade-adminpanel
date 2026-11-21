import { validateCustomerForm } from "@/lib/customer/form";
import { updateBusinessCustomer } from "@/lib/customer/manage";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** PATCH { fullName, email, phone, company?, notes?, address? } — edits one customer of this business. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) {
    return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = validateCustomerForm(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  try {
    const result = await updateBusinessCustomer(
      { uid: auth.uid, email: auth.email ?? null, name: null, role: "owner", businessId: auth.businessId },
      id,
      parsed.value,
      body?.via === "mcp" || body?.via === "voice" ? body.via : "manual",
    );
    if (result.status === "NOT_FOUND") {
      return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
    }
    if (result.status === "EMAIL_LOCKED") {
      return NextResponse.json({ ok: false, error: result.message }, { status: 400 });
    }
    if (result.status === "DUPLICATE") {
      return NextResponse.json(
        { ok: false, code: "DUPLICATE", error: `${result.customer.fullName || "Another customer"} already has this ${result.matchedOn}.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, customer: result.customer });
  } catch (error) {
    console.error("[customers] update failed:", error);
    return NextResponse.json({ ok: false, error: "Could not save the customer." }, { status: 500 });
  }
}
