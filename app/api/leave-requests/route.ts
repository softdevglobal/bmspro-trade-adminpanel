import { adminAuth } from "@/lib/firebase/admin";
import {
  createStaffLeaveRequest,
  listBusinessLeaveRequests,
} from "@/lib/leave/server";
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

async function requireStaff(request: Request) {
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
    if (!businessId || role !== "staff") {
      return {
        ok: false as const,
        status: 403,
        error: "Staff access required.",
      };
    }
    return {
      ok: true as const,
      uid: decoded.uid,
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

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const leaveRequests = await listBusinessLeaveRequests(auth.businessId);
  return NextResponse.json({ ok: true, leaveRequests });
}

export async function POST(request: Request) {
  const auth = await requireStaff(request);
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

  const result = await createStaffLeaveRequest(auth.uid, auth.businessId, {
    fromDate: typeof payload.fromDate === "string" ? payload.fromDate : "",
    toDate: typeof payload.toDate === "string" ? payload.toDate : undefined,
    isFullDay: payload.isFullDay !== false,
    startTime:
      typeof payload.startTime === "string" ? payload.startTime : null,
    endTime: typeof payload.endTime === "string" ? payload.endTime : null,
    reason: typeof payload.reason === "string" ? payload.reason : null,
    attachmentUrl:
      typeof payload.attachmentUrl === "string" ? payload.attachmentUrl : null,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, leaveRequest: result.leave });
}
