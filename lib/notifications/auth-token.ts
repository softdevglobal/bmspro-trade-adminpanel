import "server-only";

import { adminAuth } from "@/lib/firebase/admin";

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
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (!businessId || (role !== "owner" && role !== "admin")) {
      return {
        ok: false,
        status: 403,
        error: "Business owner access required.",
      };
    }
    return { ok: true, businessId };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}
