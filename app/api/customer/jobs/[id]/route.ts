import { authenticateCustomerRequest } from "@/lib/customer/server";
import { customerAcceptProposedSlot } from "@/lib/inspection/server";
import {
  isTimeRange,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { customerDecideQuotation } from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseSlot(raw: unknown): InspectionSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = typeof item.date === "string" ? item.date : "";
  const timeRange = item.timeRange;
  if (!date || !isTimeRange(timeRange)) return null;
  return { date, timeRange };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url);
  const bookingSlug = url.searchParams.get("bookingSlug")?.trim() || undefined;
  const auth = await authenticateCustomerRequest(request, { bookingSlug });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";

  if (action === "quotation_decision") {
    const decision = payload.decision;
    if (decision !== "accepted" && decision !== "rejected") {
      return NextResponse.json(
        { ok: false, error: "Choose accept or reject." },
        { status: 400 },
      );
    }

    let jobPreferredSlots: InspectionSlot[] | undefined;
    if (decision === "accepted") {
      const { validateJobPreferredSlotsForAcceptance } = await import(
        "@/lib/inspection/types"
      );
      const parsed = validateJobPreferredSlotsForAcceptance(
        payload.jobPreferredSlots,
      );
      if (!parsed.ok) {
        return NextResponse.json(
          { ok: false, error: parsed.error },
          { status: 400 },
        );
      }
      jobPreferredSlots = parsed.value;
    }

    const result = await customerDecideQuotation(
      id,
      {
        customerId: auth.customer.uid,
        customerEmail: auth.customer.email,
        businessId: auth.customer.businessId,
      },
      decision,
      jobPreferredSlots,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, decision });
  }

  if (action !== "accept_proposed") {
    if (action === "accept_job_proposed") {
      const slot = parseSlot(payload.slot);
      if (!slot) {
        return NextResponse.json(
          { ok: false, error: "Choose a valid proposed job day." },
          { status: 400 },
        );
      }
      const { customerAcceptJobProposedSlot } = await import(
        "@/lib/inspection/server"
      );
      const result = await customerAcceptJobProposedSlot(
        id,
        {
          customerId: auth.customer.uid,
          customerEmail: auth.customer.email,
          businessId: auth.customer.businessId,
        },
        slot,
      );
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error },
          { status: result.status },
        );
      }
      return NextResponse.json({ ok: true, request: result.request });
    }

    return NextResponse.json(
      { ok: false, error: "Unsupported action." },
      { status: 400 },
    );
  }

  const slot = parseSlot(payload.slot);
  if (!slot) {
    return NextResponse.json(
      { ok: false, error: "Choose a valid proposed time." },
      { status: 400 },
    );
  }

  const result = await customerAcceptProposedSlot(
    id,
    {
      customerId: auth.customer.uid,
      customerEmail: auth.customer.email,
      businessId: auth.customer.businessId,
    },
    slot,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, request: result.request });
}
