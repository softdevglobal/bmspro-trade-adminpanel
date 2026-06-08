import { logAuditEvent } from "@/lib/audit/server";
import { assignBusinessBooking, getBusinessBooking } from "@/lib/bookings/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { InspectionAssignment } from "@/lib/inspection/types";
import {
  extractBearerToken,
  requireBusinessOwnerFromToken,
} from "@/lib/notifications/auth-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function resolveStaffAssignment(
  businessId: string,
  staffId: string,
): Promise<InspectionAssignment | null> {
  const snap = await adminDb.collection("users").doc(staffId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || data.businessId !== businessId || data.role !== "staff") {
    return null;
  }
  return {
    type: "staff",
    uid: snap.id,
    name: typeof data.fullName === "string" ? data.fullName : "Staff member",
    email: typeof data.email === "string" ? data.email : null,
  };
}

async function resolveOwnerAssignment(
  uid: string,
  email: string | undefined,
): Promise<InspectionAssignment> {
  const snap = await adminDb.collection("users").doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  return {
    type: "owner",
    uid,
    name:
      data && typeof data.fullName === "string" && data.fullName.trim()
        ? data.fullName
        : email ?? "Business owner",
    email: email ?? null,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token =
    request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ??
    extractBearerToken(request);
  const auth = await requireBusinessOwnerFromToken(token);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const booking = await getBusinessBooking(auth.businessId, id);
  if (!booking) {
    return NextResponse.json(
      { ok: false, error: "Booking not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, booking });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token =
    request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ??
    extractBearerToken(request);
  const auth = await requireBusinessOwnerFromToken(token);
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

  const action = typeof payload.action === "string" ? payload.action : "";
  const { id } = await context.params;

  if (action === "assign") {
    const authHeader = request.headers.get("authorization") ?? "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: "Missing authorization header." },
        { status: 401 },
      );
    }

    let ownerUid: string;
    let ownerEmail: string | undefined;
    try {
      const decoded = await adminAuth.verifyIdToken(match[1]);
      ownerUid = decoded.uid;
      ownerEmail = decoded.email;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired session." },
        { status: 401 },
      );
    }

    const assignTo =
      typeof payload.assignTo === "string" ? payload.assignTo : "";
    let assignment: InspectionAssignment | null = null;

    if (assignTo === "owner") {
      assignment = await resolveOwnerAssignment(ownerUid, ownerEmail);
    } else if (assignTo === "staff") {
      const staffId =
        typeof payload.staffId === "string" ? payload.staffId : "";
      if (!staffId) {
        return NextResponse.json(
          { ok: false, error: "Choose a team member to assign." },
          { status: 400 },
        );
      }
      assignment = await resolveStaffAssignment(auth.businessId, staffId);
      if (!assignment) {
        return NextResponse.json(
          { ok: false, error: "Selected team member is unavailable." },
          { status: 400 },
        );
      }
    }

    if (!assignment) {
      return NextResponse.json(
        { ok: false, error: "Choose who should run this job." },
        { status: 400 },
      );
    }

    const result = await assignBusinessBooking(
      auth.businessId,
      id,
      assignment,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    await logAuditEvent({
      businessId: auth.businessId,
      category: "booking",
      action: "booking.assigned",
      actor: {
        uid: ownerUid,
        role: "owner",
        name: ownerEmail ?? null,
        email: ownerEmail ?? null,
      },
      source: "admin_panel",
      summary: `Booking assigned to ${assignment.name}`,
      targetId: id,
      targetLabel: assignment.name,
      metadata: { assignedToUid: assignment.uid, assignedToType: assignment.type },
    });

    return NextResponse.json({ ok: true, booking: result.booking });
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported action." },
    { status: 400 },
  );
}
