/**
 * Records sign-in / sign-out for business owners, staff, and customers.
 *
 * POST /api/audit/session
 * Body: { event: "login" | "logout", bookingSlug?: string }
 */

import { logAuditEvent } from "@/lib/audit/server";
import {
  actorRoleFromClaim,
  type AuditActorRole,
  type AuditSource,
} from "@/lib/audit/types";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type SessionEvent = "login" | "logout";

function parseSessionEvent(raw: unknown): SessionEvent | null {
  return raw === "login" || raw === "logout" ? raw : null;
}

async function resolveBusinessIdFromSlug(
  slug: string,
): Promise<string | null> {
  const trimmed = slug.trim();
  if (!trimmed) return null;
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", trimmed)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

async function loadUserIdentity(uid: string): Promise<{
  name: string | null;
  email: string | null;
}> {
  const snap = await adminDb.collection("users").doc(uid).get();
  const data = snap.data();
  return {
    name:
      typeof data?.fullName === "string" && data.fullName.trim()
        ? data.fullName.trim()
        : null,
    email:
      typeof data?.email === "string" && data.email.trim()
        ? data.email.trim()
        : null,
  };
}

async function loadCustomerIdentity(uid: string): Promise<{
  name: string | null;
  email: string | null;
  businessId: string | null;
  bookingSlug: string | null;
}> {
  const snap = await adminDb.collection("customers").doc(uid).get();
  if (!snap.exists) {
    return { name: null, email: null, businessId: null, bookingSlug: null };
  }
  const data = snap.data() ?? {};
  return {
    name:
      typeof data.fullName === "string" && data.fullName.trim()
        ? data.fullName.trim()
        : null,
    email:
      typeof data.email === "string" && data.email.trim()
        ? data.email.trim()
        : null,
    businessId:
      typeof data.registeredBusinessId === "string"
        ? data.registeredBusinessId
        : null,
    bookingSlug:
      typeof data.registeredBookingSlug === "string"
        ? data.registeredBookingSlug
        : null,
  };
}

function roleLabel(role: AuditActorRole): string {
  if (role === "owner" || role === "admin") return "Business owner";
  if (role === "staff") return "Staff member";
  if (role === "customer") return "Customer";
  return "User";
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

  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const event = parseSessionEvent(payload.event);
  if (!event) {
    return NextResponse.json(
      { ok: false, error: 'event must be "login" or "logout".' },
      { status: 400 },
    );
  }

  const bookingSlugInput =
    typeof payload.bookingSlug === "string" ? payload.bookingSlug.trim() : "";

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessIdClaim =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const claimRole = decoded.role;

    let businessId: string | null = null;
    let actorRole: AuditActorRole = "system";
    let actorName: string | null =
      typeof decoded.name === "string" && decoded.name.trim()
        ? decoded.name.trim()
        : null;
    let actorEmail: string | null =
      typeof decoded.email === "string" && decoded.email.trim()
        ? decoded.email.trim()
        : null;
    let source: AuditSource = "admin_panel";

    if (
      businessIdClaim &&
      (claimRole === "owner" || claimRole === "admin" || claimRole === "staff")
    ) {
      businessId = businessIdClaim;
      actorRole = actorRoleFromClaim(claimRole);
      const identity = await loadUserIdentity(decoded.uid);
      actorName = identity.name ?? actorName;
      actorEmail = identity.email ?? actorEmail;
      source = "admin_panel";
    } else {
      const customer = await loadCustomerIdentity(decoded.uid);
      actorRole = "customer";
      actorName = customer.name ?? actorName;
      actorEmail = customer.email ?? actorEmail;

      if (!actorEmail && !actorName) {
        return NextResponse.json({ ok: true, logged: false });
      }
      businessId = customer.businessId;

      const slug = bookingSlugInput || customer.bookingSlug || "";
      if (!businessId && slug) {
        businessId = await resolveBusinessIdFromSlug(slug);
      }

      source = slug || customer.bookingSlug ? "booking_engine" : "customer_portal";
    }

    if (!businessId) {
      return NextResponse.json({ ok: true, logged: false });
    }

    const label = actorName ?? actorEmail ?? roleLabel(actorRole);
    const roleText = roleLabel(actorRole);
    const portalLabel =
      source === "booking_engine" ? "booking portal" : "customer portal";
    const adminLabel = "admin panel";

    const summary =
      actorRole === "customer"
        ? event === "login"
          ? `${label} signed in to the ${portalLabel}`
          : `${label} signed out of the ${portalLabel}`
        : event === "login"
          ? `${label} (${roleText}) signed in to the ${adminLabel}`
          : `${label} (${roleText}) signed out of the ${adminLabel}`;

    const isStaffSession = actorRole === "staff";

    await logAuditEvent({
      businessId,
      category: isStaffSession ? "staff" : "auth",
      action: isStaffSession
        ? event === "login"
          ? "staff.login"
          : "staff.logout"
        : event === "login"
          ? "auth.login"
          : "auth.logout",
      actor: {
        uid: decoded.uid,
        role: actorRole,
        name: actorName,
        email: actorEmail,
      },
      source,
      summary,
      targetId: decoded.uid,
      targetLabel: label,
      metadata: {
        event,
        claimRole: typeof claimRole === "string" ? claimRole : null,
      },
    });

    return NextResponse.json({ ok: true, logged: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired session." },
      { status: 401 },
    );
  }
}
