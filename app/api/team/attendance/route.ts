import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  filterAttendanceByDateRange,
  parseAttendanceRangeParams,
  serializeAttendanceRecord,
  type TeamAttendanceRecord,
} from "@/lib/team/attendance";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessUser(request: Request): Promise<
  | {
      ok: true;
      uid: string;
      businessId: string;
    }
  | { ok: false; status: number; error: string }
> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;

    if (!businessId || (role !== "owner" && role !== "admin")) {
      return { ok: false, status: 403, error: "Business owner access required." };
    }

    return {
      ok: true,
      uid: decoded.uid,
      businessId,
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid authorization token." };
  }
}

export async function GET(request: Request) {
  const auth = await requireBusinessUser(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const dateRange = parseAttendanceRangeParams({
    date: searchParams.get("date"),
    start: searchParams.get("start"),
    end: searchParams.get("end"),
  });
  if (!dateRange) {
    return NextResponse.json(
      { ok: false, error: "Invalid date range. Use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const [byOwnerSnap, byBusinessSnap] = await Promise.all([
    adminDb
      .collection("staff_check_ins")
      .where("ownerUid", "==", auth.uid)
      .get(),
    adminDb
      .collection("staff_check_ins")
      .where("businessId", "==", auth.businessId)
      .get(),
  ]);

  const merged = new Map<string, TeamAttendanceRecord>();
  for (const snap of [byOwnerSnap, byBusinessSnap]) {
    for (const doc of snap.docs) {
      const record = serializeAttendanceRecord(doc.id, doc.data());
      if (record) merged.set(doc.id, record);
    }
  }

  const attendance = filterAttendanceByDateRange(
    Array.from(merged.values()),
    dateRange,
  ).sort(
    (a, b) =>
      new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime(),
  );

  return NextResponse.json({
    ok: true,
    date: dateRange.startDate,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    attendance,
  });
}
