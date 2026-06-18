import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { InspectionAssignment } from "@/lib/inspection/types";

export async function resolveStaffAssignment(
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

export async function resolveOwnerAssignment(
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
