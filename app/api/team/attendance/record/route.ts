import { requireBusinessMember } from "@/lib/onboarding/server";
import { adminDb } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Server timestamps and identity come from the server, never the phone payload. */
export async function POST(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "staff") return NextResponse.json({ error: "Staff access required." }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || Object.keys(body).some((key) => key !== "action") ||
        !["check_in", "check_out", "break_start", "break_end"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid attendance action." }, { status: 400 });
    }
    const sessionRef = adminDb.collection("attendance_sessions").doc(auth.uid);
    const result = await adminDb.runTransaction(async (tx) => {
      const [session, staff, business] = await tx.getAll(sessionRef,
        adminDb.collection("users").doc(auth.uid), adminDb.collection("businesses").doc(auth.businessId));
      if (staff.data()?.businessId !== auth.businessId || staff.data()?.role !== "staff" ||
          staff.data()?.isActive === false || business.data()?.isActive !== true) throw new Error("Staff account is inactive.");
      const activeId = session.data()?.checkInId as string | undefined;
      const recordRef = activeId ? adminDb.collection("staff_check_ins").doc(activeId) : adminDb.collection("staff_check_ins").doc();
      const record = activeId ? await tx.get(recordRef) : null;
      const now = Timestamp.now();
      if (body.action === "check_in") {
        if (activeId) throw new Error("You are already checked in.");
        tx.create(recordRef, { staffId: auth.uid, businessId: auth.businessId, ownerUid: business.data()?.ownerUid ?? null,
          staffName: staff.data()?.fullName ?? "", staffRole: "staff", checkInTime: FieldValue.serverTimestamp(),
          checkOutTime: null, breakPeriods: [], status: "checked_in", createdAt: FieldValue.serverTimestamp() });
        tx.set(sessionRef, { checkInId: recordRef.id });
      } else {
        const data = record?.data();
        if (!data || data.staffId !== auth.uid || data.businessId !== auth.businessId || data.checkOutTime) throw new Error("No active check-in.");
        const breaks = Array.isArray(data.breakPeriods) ? [...data.breakPeriods] as { startTime: Timestamp; endTime: Timestamp | null }[] : [];
        const open = breaks.at(-1)?.endTime === null;
        if (body.action === "break_start") {
          if (open) throw new Error("Break is already active.");
          breaks.push({ startTime: now, endTime: null });
        } else if (body.action === "break_end") {
          if (!open) throw new Error("No active break.");
          breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], endTime: now };
        } else {
          if (open) breaks[breaks.length - 1] = { ...breaks[breaks.length - 1], endTime: now };
          tx.delete(sessionRef);
        }
        const totalBreakSeconds = breaks.reduce((sum, item) => sum + (item.endTime ? Math.max(0, Math.floor((item.endTime.toMillis() - item.startTime.toMillis()) / 1000)) : 0), 0);
        tx.update(recordRef, { breakPeriods: breaks, updatedAt: FieldValue.serverTimestamp(),
          ...(body.action === "check_out" ? { checkOutTime: FieldValue.serverTimestamp(), status: "checked_out", totalBreakSeconds,
            workingSeconds: Math.max(0, Math.floor((now.toMillis() - (data.checkInTime as Timestamp).toMillis()) / 1000) - totalBreakSeconds) } : {}) });
      }
      return { checkInId: recordRef.id };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record attendance." }, { status: 409 });
  }
}
