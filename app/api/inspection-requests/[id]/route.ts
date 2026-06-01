import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { applyOwnerAction, applyStaffStart } from "@/lib/inspection/server";
import {
  isClockTime,
  isFutureOrTodayDate,
  isTimeRange,
  type InspectionAssignment,
  type InspectionSlot,
} from "@/lib/inspection/types";
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
      email: decoded.email,
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

function parseSlot(raw: unknown): InspectionSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const date = typeof item.date === "string" ? item.date : "";
  const timeRange = item.timeRange;
  if (!isFutureOrTodayDate(date)) return null;
  if (!isTimeRange(timeRange)) return null;
  return { date, timeRange };
}

/** Validates a visit time window. `endTime` must be after `startTime`. */
function parseWindow(
  payload: Record<string, unknown>,
):
  | { ok: true; startTime: string; endTime: string }
  | { ok: false; error: string } {
  const startTime =
    typeof payload.startTime === "string" ? payload.startTime.trim() : "";
  const endTime =
    typeof payload.endTime === "string" ? payload.endTime.trim() : "";
  if (!isClockTime(startTime) || !isClockTime(endTime)) {
    return { ok: false, error: "Enter a start and end time for the visit." };
  }
  if (startTime >= endTime) {
    return { ok: false, error: "The end time must be after the start time." };
  }
  return { ok: true, startTime, endTime };
}

function dedupeSlots(slots: InspectionSlot[]): InspectionSlot[] {
  const seen = new Set<string>();
  const result: InspectionSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.date}__${slot.timeRange}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(slot);
  }
  return result;
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

async function requireAssignedStaff(request: Request, requestId: string) {
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

    const snap = await adminDb
      .collection("inspection_requests")
      .doc(requestId)
      .get();
    if (!snap.exists) {
      return {
        ok: false as const,
        status: 404,
        error: "Request not found.",
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
        error: "This visit is not assigned to you.",
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing request id." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";

  if (action === "start") {
    const staffAuth = await requireAssignedStaff(request, id);
    if (!staffAuth.ok) {
      return NextResponse.json(
        { ok: false, error: staffAuth.error },
        { status: staffAuth.status },
      );
    }

    const result = await applyStaffStart(
      id,
      staffAuth.businessId,
      staffAuth.uid,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, request: result.request });
  }

  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const note = typeof payload.note === "string" ? payload.note.trim() : undefined;

  if (action === "accept") {
    const slot = parseSlot(payload.slot);
    if (!slot) {
      return NextResponse.json(
        { ok: false, error: "Choose a valid date and time range." },
        { status: 400 },
      );
    }
    const window = parseWindow(payload);
    if (!window.ok) {
      return NextResponse.json(
        { ok: false, error: window.error },
        { status: 400 },
      );
    }
    const result = await applyOwnerAction(id, auth.businessId, {
      type: "accept",
      slot,
      startTime: window.startTime,
      endTime: window.endTime,
      note,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, request: result.request });
  }

  if (action === "set_time") {
    const window = parseWindow(payload);
    if (!window.ok) {
      return NextResponse.json(
        { ok: false, error: window.error },
        { status: 400 },
      );
    }
    const result = await applyOwnerAction(id, auth.businessId, {
      type: "set_time",
      startTime: window.startTime,
      endTime: window.endTime,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, request: result.request });
  }

  if (action === "propose") {
    const rawSlots = Array.isArray(payload.slots) ? payload.slots : [];
    const slots = dedupeSlots(
      rawSlots
        .map(parseSlot)
        .filter((slot): slot is InspectionSlot => slot !== null),
    ).slice(0, 3);
    if (slots.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Add at least one proposed date and time range." },
        { status: 400 },
      );
    }
    const result = await applyOwnerAction(id, auth.businessId, {
      type: "propose",
      slots,
      note,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, request: result.request });
  }

  if (action === "assign") {
    const assignTo = typeof payload.assignTo === "string" ? payload.assignTo : "";
    let assignment: InspectionAssignment | null = null;

    if (assignTo === "owner") {
      assignment = await resolveOwnerAssignment(auth.uid, auth.email);
    } else if (assignTo === "staff") {
      const staffId = typeof payload.staffId === "string" ? payload.staffId : "";
      if (!staffId) {
        return NextResponse.json(
          { ok: false, error: "Choose a staff member to assign." },
          { status: 400 },
        );
      }
      assignment = await resolveStaffAssignment(auth.businessId, staffId);
      if (!assignment) {
        return NextResponse.json(
          { ok: false, error: "Selected staff member is unavailable." },
          { status: 400 },
        );
      }
    }

    if (!assignment) {
      return NextResponse.json(
        { ok: false, error: "Choose who should run the inspection." },
        { status: 400 },
      );
    }

    const result = await applyOwnerAction(id, auth.businessId, {
      type: "assign",
      assignment,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, request: result.request });
  }

  if (action === "cancel") {
    const result = await applyOwnerAction(id, auth.businessId, {
      type: "cancel",
      note,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ ok: true, request: result.request });
  }

  if (action === "complete") {
    const result = await applyOwnerAction(id, auth.businessId, {
      type: "complete",
      note,
    });
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
