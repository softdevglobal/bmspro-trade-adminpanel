import { adminAuth } from "@/lib/firebase/admin";
import { businessRecordQuotationCustomerDecision } from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessAuthor(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing authorization header.",
    };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (
      !businessId ||
      (role !== "staff" && role !== "owner" && role !== "admin")
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "You do not have permission to update this quotation.",
      };
    }

    return { ok: true as const, businessId };
  } catch {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid or expired session.",
    };
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBusinessAuthor(request);
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

  if (action !== "customer_decision") {
    return NextResponse.json(
      { ok: false, error: "Unsupported action." },
      { status: 400 },
    );
  }

  const decision = payload.decision;
  if (decision !== "accepted" && decision !== "rejected") {
    return NextResponse.json(
      { ok: false, error: "Choose accept or reject." },
      { status: 400 },
    );
  }

  const result = await businessRecordQuotationCustomerDecision(
    id,
    auth.businessId,
    decision,
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    decision,
    request: result.request,
  });
}
