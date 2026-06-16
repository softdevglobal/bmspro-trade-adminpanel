import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import {
  assignBusinessBooking,
  completeBusinessBooking,
  getBusinessBooking,
  startBusinessBookingJob,
  startBusinessBookingVisit,
} from "@/lib/bookings/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { findApprovedLeaveBlocking } from "@/lib/leave/server";
import type { InspectionAssignment } from "@/lib/inspection/types";
import {
  extractBearerToken,
  requireBusinessOwnerFromToken,
} from "@/lib/notifications/auth-token";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function clockToMinutes(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = parts.length > 1 ? Number.parseInt(parts[1] ?? "", 10) : 0;
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

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
      { ok: false, error: "Job not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, booking });
}

async function requireAssignedBookingOperator(
  request: Request,
  bookingId: string,
) {
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
        error: "You do not have permission to start this visit.",
      };
    }

    const snap = await adminDb.collection("jobs").doc(bookingId).get();
    if (!snap.exists) {
      return {
        ok: false as const,
        status: 404,
        error: "Job not found.",
      };
    }

    const data = snap.data();
    const assigned = data?.assignedTo as { uid?: string } | null;
    if (
      !data ||
      data.businessId !== businessId ||
      assigned?.uid !== decoded.uid
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "This job is not assigned to you.",
      };
    }

    const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;

    return {
      ok: true as const,
      uid: decoded.uid,
      businessId,
      role: actorRoleFromClaim(role),
      name:
        userData && typeof userData.fullName === "string"
          ? userData.fullName
          : decoded.email ?? null,
      email: decoded.email ?? null,
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

  if (action === "start") {
    const operatorAuth = await requireAssignedBookingOperator(request, id);
    if (!operatorAuth.ok) {
      return NextResponse.json(
        { ok: false, error: operatorAuth.error },
        { status: operatorAuth.status },
      );
    }

    const result = await startBusinessBookingVisit(
      id,
      operatorAuth.businessId,
      operatorAuth.uid,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    await logAuditEvent({
      businessId: operatorAuth.businessId,
      category: "booking",
      action: "booking.visit_started",
      actor: {
        uid: operatorAuth.uid,
        role: operatorAuth.role,
        name: operatorAuth.name,
        email: operatorAuth.email,
      },
      source: "mobile_app",
      summary: `Visit started for job ${result.booking.bookingCode ?? id}`,
      targetId: id,
      targetLabel: result.booking.bookingCode ?? null,
    });

    return NextResponse.json({ ok: true, booking: result.booking });
  }

  if (action === "start_booking") {
    const operatorAuth = await requireAssignedBookingOperator(request, id);
    if (!operatorAuth.ok) {
      return NextResponse.json(
        { ok: false, error: operatorAuth.error },
        { status: operatorAuth.status },
      );
    }

    const result = await startBusinessBookingJob(
      id,
      operatorAuth.businessId,
      operatorAuth.uid,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    await logAuditEvent({
      businessId: operatorAuth.businessId,
      category: "booking",
      action: "booking.job_started",
      actor: {
        uid: operatorAuth.uid,
        role: operatorAuth.role,
        name: operatorAuth.name,
        email: operatorAuth.email,
      },
      source: "mobile_app",
      summary: `Job started for ${result.booking.bookingCode ?? id}`,
      targetId: id,
      targetLabel: result.booking.bookingCode ?? null,
    });

    return NextResponse.json({ ok: true, booking: result.booking });
  }

  if (action === "complete") {
    const operatorAuth = await requireAssignedBookingOperator(request, id);
    if (!operatorAuth.ok) {
      return NextResponse.json(
        { ok: false, error: operatorAuth.error },
        { status: operatorAuth.status },
      );
    }

    const result = await completeBusinessBooking(
      id,
      operatorAuth.businessId,
      operatorAuth.uid,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    await logAuditEvent({
      businessId: operatorAuth.businessId,
      category: "booking",
      action: "booking.completed",
      actor: {
        uid: operatorAuth.uid,
        role: operatorAuth.role,
        name: operatorAuth.name,
        email: operatorAuth.email,
      },
      source: "mobile_app",
      summary: `Job ${result.booking.bookingCode ?? id} completed`,
      targetId: id,
      targetLabel: result.booking.bookingCode ?? null,
    });

    return NextResponse.json({ ok: true, booking: result.booking });
  }

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

    if (assignment.type === "staff") {
      const booking = await getBusinessBooking(auth.businessId, id);
      const scheduledDate = booking?.scheduledSlot?.date ?? null;
      if (scheduledDate) {
        const blocking = await findApprovedLeaveBlocking(
          auth.businessId,
          assignment.uid,
          scheduledDate,
          clockToMinutes(booking?.scheduledStartTime) ?? undefined,
          clockToMinutes(booking?.scheduledEndTime) ?? undefined,
        );
        if (blocking) {
          return NextResponse.json(
            {
              ok: false,
              error: `${assignment.name} has approved time off on ${scheduledDate} and cannot be assigned that day.`,
            },
            { status: 409 },
          );
        }
      }
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
      summary: `Job assigned to ${assignment.name}`,
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
