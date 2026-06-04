import "server-only";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { DecodedIdToken } from "firebase-admin/auth";

/**
 * Returns true when the decoded token belongs to a super admin (claims or
 * `super_admins/{uid}` document).
 */
async function isSuperAdmin(decoded: DecodedIdToken): Promise<boolean> {
  if (decoded.superAdmin === true || decoded.role === "super_admin") {
    return true;
  }
  const snap = await adminDb.collection("super_admins").doc(decoded.uid).get();
  return snap.exists && snap.data()?.isActive !== false;
}

/**
 * Verifies that the request carries a valid Firebase ID token for either:
 *   - a call-center agent (`role: "call_center"`), or
 *   - a super admin (platform-wide access to all call-center APIs).
 *
 * Super admins use the same Bearer token as in other admin routes (from
 * Firebase `signInWithPassword` with a super-admin account).
 *
 * Usage in a route handler:
 *   const auth = await requireCallCenterAgent(request);
 *   if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
 */
export async function requireCallCenterAgent(req: Request): Promise<
  | { ok: true; uid: string; email: string | undefined; isSuperAdmin: boolean }
  | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);

    if (decoded.role === "call_center") {
      return {
        ok: true,
        uid: decoded.uid,
        email: decoded.email,
        isSuperAdmin: false,
      };
    }

    if (await isSuperAdmin(decoded)) {
      return {
        ok: true,
        uid: decoded.uid,
        email: decoded.email,
        isSuperAdmin: true,
      };
    }

    return {
      ok: false,
      status: 403,
      error: "Call-center or super admin access required.",
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}
