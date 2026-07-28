import { listBusinessCustomers } from "@/lib/customer/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
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
