import { computeDaySlotOccupancy } from "@/lib/calendar/slot-occupancy";
import { adminAuth } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

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
    // Read-only occupancy is also surfaced to staff in the mobile calendar so
    // they can see the day's slot order (without editing).
    if (
      !businessId ||
      (role !== "owner" && role !== "admin" && role !== "staff")
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "Business team access required.",
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

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const date = new URL(request.url).searchParams.get("date")?.trim() ?? "";
  if (!isIsoDate(date)) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid date." },
      { status: 400 },
    );
  }

  const occupancy = await computeDaySlotOccupancy(auth.businessId, date);
  return NextResponse.json({ ok: true, ...occupancy });
}
