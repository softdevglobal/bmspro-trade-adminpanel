import "server-only";

import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

const WORKSHOP_CHAT_ROLES = new Set(["owner", "admin", "staff"]);

export type WorkshopChatAuth = {
  ok: true;
  uid: string;
  email: string | undefined;
  businessId: string;
  role: string;
};

export async function requireWorkshopChatUser(req: Request): Promise<
  WorkshopChatAuth | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = typeof decoded.role === "string" ? decoded.role : "";

    if (!businessId || !WORKSHOP_CHAT_ROLES.has(role)) {
      return {
        ok: false,
        status: 403,
        error: "Workshop chat access required.",
      };
    }

    return {
      ok: true,
      uid: decoded.uid,
      email: decoded.email,
      businessId,
      role,
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

export { requireCallCenterAgent };

export async function getUserProfile(uid: string): Promise<{
  fullName: string;
  email: string;
  phone: string;
  role: string;
  businessId: string | null;
  ownerUid: string | null;
}> {
  const snap = await adminDb.collection("users").doc(uid).get();
  const data = snap.data() ?? {};
  const businessId =
    typeof data.businessId === "string" ? data.businessId : null;

  let ownerUid: string | null = null;
  if (businessId) {
    const biz = await adminDb.collection("businesses").doc(businessId).get();
    const bizOwner = biz.data()?.ownerUid;
    ownerUid = typeof bizOwner === "string" ? bizOwner : null;
  }

  return {
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    email: typeof data.email === "string" ? data.email : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    role: typeof data.role === "string" ? data.role : "",
    businessId,
    ownerUid,
  };
}

export async function getCallCenterAgentProfile(uid: string): Promise<{
  fullName: string;
  email: string;
}> {
  const agentSnap = await adminDb
    .collection("call_center_agents")
    .doc(uid)
    .get();
  if (agentSnap.exists) {
    const data = agentSnap.data() ?? {};
    return {
      fullName:
        typeof data.fullName === "string"
          ? data.fullName
          : typeof data.displayName === "string"
            ? data.displayName
            : "",
      email: typeof data.email === "string" ? data.email : "",
    };
  }

  const userSnap = await adminDb.collection("users").doc(uid).get();
  const data = userSnap.data() ?? {};
  return {
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    email: typeof data.email === "string" ? data.email : "",
  };
}
