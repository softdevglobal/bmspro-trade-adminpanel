/**
 * Records an in-app password change after the client updates Firebase Auth.
 *
 * POST /api/audit/password-change
 */

import {
  actorRoleFromClaim,
  logPasswordChanged,
  resolveAuditIdentityForUid,
} from "@/lib/audit/action-logs";
import type { AuditSource } from "@/lib/audit/types";
import { adminAuth } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "Missing authorization header." },
      { status: 401 },
    );
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const identity = await resolveAuditIdentityForUid(decoded.uid);
    const claimRole = actorRoleFromClaim(decoded.role ?? identity.role);
    const role = identity.role === "customer" ? "customer" : claimRole;
    const source: AuditSource =
      role === "customer" ? "customer_portal" : "admin_panel";

    await logPasswordChanged({
      uid: decoded.uid,
      email: decoded.email ?? identity.email,
      name: identity.name,
      role,
      businessId:
        typeof decoded.businessId === "string"
          ? decoded.businessId
          : identity.businessId,
      source,
      method: "in_app",
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired session." },
      { status: 401 },
    );
  }
}
