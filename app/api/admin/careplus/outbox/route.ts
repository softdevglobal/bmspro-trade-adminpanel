import {
  listCareplusOutbox,
  processCareplusOutbox,
  retryCareplusOutboxEvent,
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

  let action: string | undefined;
  let businessId: string | undefined;
  let eventId: string | undefined;
  try {
    const body = (await request.json()) as {
      action?: unknown;
      businessId?: unknown;
      eventId?: unknown;
    };
    if (typeof body.action === "string") action = body.action.trim();
    if (typeof body.businessId === "string" && body.businessId.trim()) {
      businessId = body.businessId.trim();
    }
    if (typeof body.eventId === "string") eventId = body.eventId.trim();
  } catch {
    businessId = undefined;
  }

  try {
    if (action === "retry" && eventId) {
      const outbox = await retryCareplusOutboxEvent(eventId);
      const result = await processCareplusOutbox({
        businessId: outbox.businessId,
        ignoreBackoff: true,
      });
      return NextResponse.json({ ok: true, outbox, ...result });
    }
    const result = await processCareplusOutbox({
      businessId,
      ignoreBackoff: true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[careplus] outbox POST failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not process the CarePlus outbox.",
      },
      { status: 500 },
    );
  }
}
