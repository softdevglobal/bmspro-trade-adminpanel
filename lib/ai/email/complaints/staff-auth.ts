import "server-only";

import { verifyAccountIdToken } from "@/lib/auth/account-access";

/**
 * The technician behind a staff-app request for Sophie's questions: a signed-in staff member of a
 * business. The questions and answers routes also check that the question is theirs.
 */
export async function requireSophieStaff(
  request: Request,
): Promise<{ ok: true; uid: string; businessId: string } | { ok: false; status: number; error: string }> {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer (.+)$/);
  if (!match) return { ok: false, status: 401, error: "Missing authorization header." };
  try {
    const decoded = await verifyAccountIdToken(match[1]);
    const businessId = typeof decoded.businessId === "string" ? decoded.businessId : null;
    if (!businessId || decoded.role !== "staff") return { ok: false, status: 403, error: "Staff access required." };
    return { ok: true, uid: decoded.uid, businessId };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}
