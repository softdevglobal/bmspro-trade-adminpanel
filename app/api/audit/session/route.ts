/**
 * Records business-owner sign-in / sign-out in the super-admin audit log.
 *
 * POST /api/audit/session
 * Body: { event: "login" | "logout" }
 * Auth: Bearer Firebase ID token (owner or admin with businessId claim)
 */

import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SessionEvent = "login" | "logout";

function parseSessionEvent(raw: unknown): SessionEvent | null {
  return raw === "login" || raw === "logout" ? raw : null;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "Missing authorization header." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const event = parseSessionEvent(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).event
      : null,
  );
  if (!event) {
    return NextResponse.json(
      { ok: false, error: 'event must be "login" or "logout".' },
      { status: 400 },
    );
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const claimRole = decoded.role;

    if (
      !businessId ||
      (claimRole !== "owner" && claimRole !== "admin")
    ) {
      return NextResponse.json({ ok: true, logged: false });
    }

    let actorName =
      typeof decoded.name === "string" && decoded.name.trim()
        ? decoded.name.trim()
        : null;
    let actorEmail =
      typeof decoded.email === "string" && decoded.email.trim()
        ? decoded.email.trim()
        : null;

    const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
    const userData = userSnap.data();
    if (
      typeof userData?.fullName === "string" &&
      userData.fullName.trim()
    ) {
      actorName = userData.fullName.trim();
    }
    if (
      typeof userData?.email === "string" &&
      userData.email.trim() &&
      !actorEmail
    ) {
      actorEmail = userData.email.trim();
    }

    const label = actorName ?? actorEmail ?? "Business owner";

    await logAuditEvent({
      businessId,
      category: "auth",
      action: event === "login" ? "auth.login" : "auth.logout",
      actor: {
        uid: decoded.uid,
        role: actorRoleFromClaim(claimRole),
        name: actorName,
        email: actorEmail,
      },
      source: "admin_panel",
      summary:
        event === "login"
          ? `${label} signed in to the admin panel`
          : `${label} signed out of the admin panel`,
      targetId: decoded.uid,
      targetLabel: label,
      metadata: { event },
    });

    return NextResponse.json({ ok: true, logged: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired session." },
      { status: 401 },
    );
  }
}
