import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";

export async function requireSophieOwner(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return auth;
  if (auth.role !== "owner") {
    return { ok: false as const, status: 403, error: "Business owner access required." };
  }
  const business = (await adminDb.collection("businesses").doc(auth.businessId).get()).data();
  if (business?.ownerUid !== auth.uid || business.isActive !== true ||
      !isTenantAccessAllowed(business.status, business.isActive)) {
    return { ok: false as const, status: 403, error: "Business owner access required." };
  }
  return {
    ...auth,
    timezone: typeof business.timezone === "string" ? business.timezone : null,
    sophieTalkEnabled: business.sophieTalkEnabled === true,
    sophieLiveListenEnabled: business.sophieLiveListenEnabled === true,
  };
}

export async function requireOwnerBriefing(request: Request) {
  const auth = await requireSophieOwner(request);
  if (!auth.ok) return auth;
  if (!auth.sophieTalkEnabled) {
    return { ok: false as const, status: 403, error: "Enable Talk to Sophie in Business settings." };
  }
  return auth;
}
