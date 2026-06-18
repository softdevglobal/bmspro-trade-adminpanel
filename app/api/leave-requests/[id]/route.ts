import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  decideLeaveRequest,
  findLeaveAssignmentConflicts,
  mapLeaveDoc,
} from "@/lib/leave/server";
import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import type { LeaveReassignment } from "@/lib/leave/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const LEAVE_COLLECTION = "leaveRequests";

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

function parseReassignments(raw: unknown): LeaveReassignment[] {
  if (!Array.isArray(raw)) return [];
  const result: LeaveReassignment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const kind = item.kind === "job" || item.kind === "request" ? item.kind : null;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const assignTo =
      item.assignTo === "owner" || item.assignTo === "staff"
        ? item.assignTo
        : null;
    if (!kind || !id || !assignTo) continue;
    result.push({
      kind,
      id,
      assignTo,
      staffId:
        typeof item.staffId === "string" ? item.staffId.trim() : undefined,
    });
  }
  return result;
}

export async function GET(
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

  const { id } = await context.params;
  const snap = await adminDb.collection(LEAVE_COLLECTION).doc(id).get();
  if (!snap.exists) {
    return NextResponse.json(
      { ok: false, error: "Leave request not found." },
      { status: 404 },
    );
  }
  const leave = mapLeaveDoc(snap.id, snap.data() ?? {});
  if (leave.businessId !== auth.businessId) {
    return NextResponse.json(
      { ok: false, error: "Leave request not found." },
      { status: 404 },
    );
  }

  const conflicts = await findLeaveAssignmentConflicts(leave);
  return NextResponse.json({ ok: true, conflicts });
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
  const reassignments = parseReassignments(payload.reassignments);

  const result = await decideLeaveRequest(id, auth.businessId, {
    action,
    reason,
    reviewerUid: auth.uid,
    reviewerEmail: auth.email ?? undefined,
    reassignments,
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
