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
  const auth = await authenticateCustomerRequest(request);
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
    const result = await customerDecideQuotation(
      id,
      { customerId: auth.customer.uid, customerEmail: auth.customer.email },
      decision,
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
    { customerId: auth.customer.uid, customerEmail: auth.customer.email },
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
