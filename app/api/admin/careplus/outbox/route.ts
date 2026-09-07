import {
  listCareplusOutbox,
  processCareplusOutbox,
} from "@/lib/integrations/careplus/outbox";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const businessId = url.searchParams.get("businessId")?.trim() || undefined;
  const outbox = await listCareplusOutbox(businessId);
  return NextResponse.json({ ok: true, outbox });
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let businessId: string | undefined;
  try {
    const body = (await request.json()) as { businessId?: unknown };
    if (typeof body.businessId === "string" && body.businessId.trim()) {
      businessId = body.businessId.trim();
    }
  } catch {
    businessId = undefined;
  }

  try {
    const result = await processCareplusOutbox({ businessId });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not process the CarePlus outbox." },
      { status: 500 },
    );
  }
}
