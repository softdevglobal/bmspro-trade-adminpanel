import "server-only";

import { logAuditEvent } from "@/lib/audit/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { TenantStatus } from "@/lib/onboarding/types";
import { FieldValue } from "firebase-admin/firestore";

export const BUSINESS_SUSPENDED_CODE = "BUSINESS_SUSPENDED";

export const BUSINESS_SUSPENDED_MESSAGE =
  "This business account has been suspended. Contact support for assistance.";

export type BusinessAccessDenied = {
  ok: false;
  status: number;
  error: string;
  code?: string;
};

export function isTenantAccessAllowed(
  status: unknown,
  isActive: unknown,
): boolean {
  if (isActive === false) return false;
  if (status === "suspended") return false;
  return true;
}

export async function getBusinessAccessState(businessId: string): Promise<
  | {
      ok: true;
      status: TenantStatus;
      isActive: boolean;
      businessName: string;
    }
  | { ok: false; reason: "not_found" }
> {
  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) {
    return { ok: false, reason: "not_found" };
  }

  const data = snap.data() ?? {};
  const status =
    data.status === "suspended" ||
    data.status === "pending_review" ||
    data.status === "active"
      ? data.status
      : "active";

  return {
    ok: true,
    status,
    isActive: data.isActive === true,
    businessName:
      typeof data.businessName === "string" && data.businessName.trim()
        ? data.businessName.trim()
        : "Business",
  };
}

export async function assertBusinessActive(
  businessId: string,
): Promise<BusinessAccessDenied | null> {
  const state = await getBusinessAccessState(businessId);
  if (!state.ok) {
    return {
      ok: false,
      status: 404,
      error: "Business not found.",
      code: "BUSINESS_NOT_FOUND",
    };
  }

  if (!isTenantAccessAllowed(state.status, state.isActive)) {
    return {
      ok: false,
      status: 403,
      error: BUSINESS_SUSPENDED_MESSAGE,
      code: BUSINESS_SUSPENDED_CODE,
    };
  }

  return null;
}

async function setAuthDisabled(uid: string, disabled: boolean) {
  try {
    await adminAuth.updateUser(uid, { disabled });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      throw error;
    }
  }
}

async function syncBusinessMemberAuthAccess(
  businessId: string,
  suspended: boolean,
) {
  const usersSnap = await adminDb
    .collection("users")
    .where("businessId", "==", businessId)
    .get();

  await Promise.all(
    usersSnap.docs.map(async (userDoc) => {
      const data = userDoc.data();
      const role = typeof data.role === "string" ? data.role : "";
      const staffStatus =
        typeof data.status === "string" ? data.status : "active";

      let disabled = suspended;
      if (!suspended) {
        disabled = role === "staff" && staffStatus === "suspended";
      }

      await setAuthDisabled(userDoc.id, disabled);
    }),
  );
}

export async function updateTenantStatus(input: {
  businessId: string;
  status: Extract<TenantStatus, "active" | "suspended">;
  actorUid: string;
  actorEmail?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const snap = await adminDb.collection("businesses").doc(input.businessId).get();
  if (!snap.exists) {
    return { ok: false, error: "Tenant not found." };
  }

  const data = snap.data() ?? {};
  const businessName =
    typeof data.businessName === "string" && data.businessName.trim()
      ? data.businessName.trim()
      : "Business";
  const currentStatus = data.status;
  const nextIsActive = input.status === "active";

  if (currentStatus === input.status && data.isActive === nextIsActive) {
    return { ok: true };
  }

  await adminDb.collection("businesses").doc(input.businessId).update({
    status: input.status,
    isActive: nextIsActive,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await syncBusinessMemberAuthAccess(input.businessId, input.status === "suspended");

  await logAuditEvent({
    businessId: input.businessId,
    category: "auth",
    action:
      input.status === "suspended" ? "tenant.suspended" : "tenant.reactivated",
    actor: {
      uid: input.actorUid,
      role: "super_admin",
      name: null,
      email: input.actorEmail ?? null,
    },
    source: "admin_panel",
    summary:
      input.status === "suspended"
        ? `Tenant ${businessName} was suspended by super admin.`
        : `Tenant ${businessName} was reactivated by super admin.`,
    targetId: input.businessId,
    targetLabel: businessName,
    metadata: { status: input.status },
  });

  return { ok: true };
}
