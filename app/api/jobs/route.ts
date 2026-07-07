import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { createDirectJob, listBusinessBookings } from "@/lib/bookings/server";
import { resolveJobAssignmentFromPayload } from "@/lib/bookings/resolve-job-assignment";
import { estimateMinutesFromTimeRange } from "@/lib/bookings/job-estimate";
import { parseCalendarScheduleInput } from "@/lib/calendar/schedule-input";
import { parseWorkingHoursFromBusiness } from "@/lib/calendar/working-hours";
import type { BusinessWorkingHours } from "@/lib/calendar/working-hours";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  parseInspectionRequestInput,
  sortInspectionSlots,
  timeRangeFromStartTime,
  type InspectionSlot,
} from "@/lib/inspection/types";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";
import {
  extractBearerToken,
  requireBusinessOwnerFromToken,
} from "@/lib/notifications/auth-token";
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
      name: typeof decoded.name === "string" ? decoded.name : null,
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

function deriveScheduleFromPreferredSlots(
  slots: InspectionSlot[],
): {
  slot: InspectionSlot;
  startTime: string;
  endTime: string;
  additionalJobDays: InspectionSlot[];
} | null {
  const sorted = sortInspectionSlots(
    slots.filter((entry) => entry.date?.trim()),
  );
  const first = sorted[0];
  if (!first?.date?.trim()) return null;
  const startTime = first.startTime?.trim() || "08:00";
  const endTime = first.endTime?.trim() || "09:00";
  return {
    startTime,
    endTime,
    slot: {
      date: first.date,
      timeRange: first.timeRange ?? timeRangeFromStartTime(startTime),
      startTime,
      endTime,
    },
    additionalJobDays: sorted.slice(1).map((entry) => ({
      date: entry.date,
      timeRange: entry.timeRange ?? timeRangeFromStartTime(entry.startTime ?? "08:00"),
      startTime: entry.startTime?.trim() || "08:00",
      endTime: entry.endTime?.trim() || "09:00",
    })),
  };
}

function resolveJobSchedule(
  payload: Record<string, unknown>,
  preferredSlots: InspectionSlot[],
  workingHours: BusinessWorkingHours,
): {
  slot: InspectionSlot;
  startTime: string;
  endTime: string;
  additionalJobDays: InspectionSlot[];
} | null {
  const calendar = parseCalendarScheduleInput(
    payload.calendarSchedule,
    workingHours,
  );
  if (calendar) {
    return {
      slot: {
        date: calendar.date,
        timeRange: timeRangeFromStartTime(calendar.startTime),
        startTime: calendar.startTime,
        endTime: calendar.endTime,
      },
      startTime: calendar.startTime,
      endTime: calendar.endTime,
      additionalJobDays: [],
    };
  }
  return deriveScheduleFromPreferredSlots(preferredSlots);
}

export async function GET(request: Request) {
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

  const jobs = await listBusinessBookings(auth.businessId);
  return NextResponse.json({ ok: true, jobs });
}

/** Owner-authenticated direct job create (skips inspection → quote flow). */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
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

  const payload = body as Record<string, unknown>;
  const businessSnap = await adminDb
    .collection("businesses")
    .doc(auth.businessId)
    .get();
  const businessData = businessSnap.data() ?? {};
  const timeZone =
    typeof businessData.timezone === "string" && businessData.timezone.trim()
      ? businessData.timezone.trim()
      : PLATFORM_TIME_ZONE;

  // Owner-created direct job: the service address is optional here.
  const parsed = parseInspectionRequestInput(body, timeZone, {
    requireAddress: false,
  });
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const workingHours = parseWorkingHoursFromBusiness(businessData);
  const jobSchedule = resolveJobSchedule(
    payload,
    parsed.value.preferredSlots,
    workingHours,
  );

  if (!jobSchedule) {
    return NextResponse.json(
      { ok: false, error: "Choose a date and time for the job." },
      { status: 400 },
    );
  }

  const estimatedDurationMinutes =
    typeof payload.estimatedDurationMinutes === "number" &&
    Number.isFinite(payload.estimatedDurationMinutes) &&
    payload.estimatedDurationMinutes > 0
      ? Math.round(payload.estimatedDurationMinutes)
      : estimateMinutesFromTimeRange(
          jobSchedule.startTime,
          jobSchedule.endTime,
        );

  const note =
    typeof payload.note === "string" ? payload.note.trim() : undefined;
  const instructionDescription =
    typeof payload.instructionDescription === "string"
      ? payload.instructionDescription.trim()
      : undefined;
  const instructionTasks = Array.isArray(payload.instructionTasks)
    ? payload.instructionTasks
        .filter((task): task is string => typeof task === "string")
        .map((task) => task.trim())
        .filter(Boolean)
    : undefined;

  const assignTo =
    typeof payload.assignTo === "string" ? payload.assignTo : "";
  const assignmentResult = await resolveJobAssignmentFromPayload({
    businessId: auth.businessId,
    ownerUid: auth.uid,
    ownerEmail: auth.email,
    assignTo,
    staffId:
      typeof payload.staffId === "string" ? payload.staffId : undefined,
    scheduledDate: jobSchedule.slot.date,
    scheduledStartTime: jobSchedule.startTime,
    scheduledEndTime: jobSchedule.endTime,
  });
  if (!assignmentResult.ok) {
    return NextResponse.json(
      { ok: false, error: assignmentResult.error },
      { status: assignmentResult.status },
    );
  }

  const result = await createDirectJob(
    auth.businessId,
    auth.uid,
    {
      requestType: parsed.value.requestType,
      serviceId: parsed.value.serviceId,
      customRequest: parsed.value.customRequest,
      customer: parsed.value.customer,
      address: parsed.value.address,
      customerNotes: parsed.value.customerNotes,
      budgetAud: parsed.value.budgetAud,
      slot: jobSchedule.slot,
      startTime: jobSchedule.startTime,
      endTime: jobSchedule.endTime,
      additionalJobDays: jobSchedule.additionalJobDays,
      estimatedDurationMinutes,
      note: note || null,
      instructionDescription: instructionDescription || null,
      instructionTasks,
      assignedTo: assignmentResult.assignment,
    },
    {
      actor: {
        uid: auth.uid,
        role: actorRoleFromClaim(auth.role),
        name: auth.name,
        email: auth.email,
      },
      source: "admin_panel",
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "inspection",
    action: "inspection.created",
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: auth.name,
      email: auth.email,
    },
    source: "admin_panel",
    summary: `Direct job ${result.booking.bookingCode ?? result.booking.id} created — request and quotation marked complete`,
    targetId: result.request.id,
    targetLabel:
      result.request.serviceName ||
      result.request.customRequest?.title ||
      result.request.customer.fullName ||
      null,
    metadata: {
      requestCode: result.request.requestCode ?? null,
      bookingId: result.booking.id,
      bookingCode: result.booking.bookingCode ?? null,
      createdSource: "job_direct",
    },
  });

  return NextResponse.json(
    {
      ok: true,
      jobId: result.booking.id,
      booking: result.booking,
      request: result.request,
    },
    { status: 201 },
  );
}
