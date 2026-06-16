import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { adminAuth } from "@/lib/firebase/admin";
import { decideLeaveRequest } from "@/lib/leave/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessOwner(request: Request) {
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
    if (!businessId || (role !== "owner" && role !== "admin")) {
      return {
        ok: false as const,
        status: 403,
        error: "Business owner access required.",
      };
    }
    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: typeof role === "string" ? role : null,
      businessId,
    };
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
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const action =
    typeof payload.action === "string" ? payload.action.trim() : "";
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { ok: false, error: "Unsupported action." },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const reason = typeof payload.reason === "string" ? payload.reason : "";

  const result = await decideLeaveRequest(id, auth.businessId, {
    action,
    reason,
    reviewerUid: auth.uid,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "staff",
    action: action === "approve" ? "leave.approved" : "leave.rejected",
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: auth.email,
      email: auth.email,
    },
    source: "admin_panel",
    summary:
      action === "approve"
        ? `Approved leave for ${result.leave.requesterName}`
        : `Rejected leave for ${result.leave.requesterName}`,
    targetId: result.leave.id,
    targetLabel: result.leave.requesterName,
    metadata: {
      requesterUid: result.leave.requesterUid,
      fromDate: result.leave.fromDate,
      toDate: result.leave.toDate,
    },
  });

  return NextResponse.json({ ok: true, leaveRequest: result.leave });
}
