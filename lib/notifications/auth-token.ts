import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";

export type BusinessOwnerAuth =
  | { ok: true; businessId: string }
  | { ok: false; status: number; error: string };

/** Bearer token from header or `access_token` query (for EventSource). */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const headerMatch = authHeader.match(/^Bearer (.+)$/);
  if (headerMatch?.[1]) return headerMatch[1];

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("access_token")?.trim();
  return queryToken || null;
}

const OWNER_ROLES = new Set([
  "owner",
  "admin",
  "business_owner",
  "salon_owner",
]);

async function resolveOwnerBusinessId(
  uid: string,
): Promise<string | null> {
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) return null;

  const userData = userSnap.data() ?? {};
  const role = typeof userData.role === "string" ? userData.role : "";
  if (!OWNER_ROLES.has(role)) return null;

  const docBusinessId =
    typeof userData.businessId === "string" ? userData.businessId.trim() : "";
  if (docBusinessId) return docBusinessId;

  const bizSnap = await adminDb
    .collection("businesses")
    .where("ownerUid", "==", uid)
    .limit(1)
    .get();
  if (!bizSnap.empty) return bizSnap.docs[0].id;

  return null;
}

export async function requireBusinessOwnerFromToken(
  token: string | null,
): Promise<BusinessOwnerAuth> {
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing authorization token.",
    };
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const claimBusinessId =
      typeof decoded.businessId === "string"
        ? decoded.businessId.trim()
        : "";
    const claimRole =
      typeof decoded.role === "string" ? decoded.role : "";

    if (
      claimBusinessId &&
      (claimRole === "owner" || claimRole === "admin")
    ) {
      return { ok: true, businessId: claimBusinessId };
    }

    const resolved = await resolveOwnerBusinessId(decoded.uid);
    if (resolved) {
      return { ok: true, businessId: resolved };
    }

    return {
      ok: false,
      status: 403,
      error: "Business owner access required.",
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}
