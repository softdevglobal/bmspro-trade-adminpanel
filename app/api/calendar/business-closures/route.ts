import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim, type AuditActor } from "@/lib/audit/types";
import {
  createBusinessClosure,
  deleteBusinessClosure,
  getBusinessClosure,
  listBusinessClosuresInRange,
  loadClosureConflicts,
} from "@/lib/calendar/business-closures/server";
import { parseCreateBusinessClosureInput } from "@/lib/calendar/business-closures/types";
import { adminAuth } from "@/lib/firebase/admin";
import { formatIsoDateInPlatformTimeZone } from "@/lib/platform/timezone";
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

function auditActor(auth: {
  uid: string;
  email: string | undefined;
  role: string | null;
}): AuditActor {
  return {
    uid: auth.uid,
    role: actorRoleFromClaim(auth.role),
    name: auth.email ?? null,
    email: auth.email ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() ?? "";
  const fromDate = url.searchParams.get("from")?.trim() ?? "";
  const toDate = url.searchParams.get("to")?.trim() ?? "";

  if (date) {
    const [closure, conflicts] = await Promise.all([
      getBusinessClosure(auth.businessId, date),
      loadClosureConflicts(auth.businessId, date),
    ]);
    return NextResponse.json({
      ok: true,
      closure,
      conflicts,
      isClosed: closure != null,
    });
  }

  if (fromDate && toDate) {
    try {
      const closures = await listBusinessClosuresInRange(
        auth.businessId,
        fromDate,
        toDate,
      );
      return NextResponse.json({ ok: true, closures });
    } catch (error) {
      console.error("[business-closures] list failed:", error);
      return NextResponse.json(
        { ok: false, error: "Could not load business off days." },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { ok: false, error: "Provide date or from/to query parameters." },
    { status: 400 },
  );
}

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

  const parsed = parseCreateBusinessClosureInput(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const result = await createBusinessClosure(auth.businessId, auth.uid, parsed.value);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  const dateLabel = formatIsoDateInPlatformTimeZone(
    parsed.value.date,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );

  await logAuditEvent({
    businessId: auth.businessId,
    category: "booking",
    action: "business_closure.created",
    actor: auditActor(auth),
    source: "admin_panel",
    summary: `Business off day marked for ${dateLabel}`,
    targetId: result.closure.id,
    targetLabel: parsed.value.date,
    metadata: {
      reason: parsed.value.reason,
      conflictCount: result.conflicts.length,
    },
  });

  return NextResponse.json({
    ok: true,
    closure: result.closure,
    conflicts: result.conflicts,
  });
}

export async function DELETE(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const date = new URL(request.url).searchParams.get("date")?.trim() ?? "";
  const result = await deleteBusinessClosure(auth.businessId, date);
  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  const dateLabel = formatIsoDateInPlatformTimeZone(
    date,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );

  await logAuditEvent({
    businessId: auth.businessId,
    category: "booking",
    action: "business_closure.removed",
    actor: auditActor(auth),
    source: "admin_panel",
    summary: `Business off day removed for ${dateLabel}`,
    targetLabel: date,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
