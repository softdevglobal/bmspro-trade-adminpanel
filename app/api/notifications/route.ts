import { adminAuth } from "@/lib/firebase/admin";
import {
  deleteAllNotifications,
  listBusinessNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessOwner(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false as const, status: 401, error: "Missing authorization header." };
  }
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (!businessId || (role !== "owner" && role !== "admin")) {
      return { ok: false as const, status: 403, error: "Business owner access required." };
    }
    return { ok: true as const, businessId };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid or expired session." };
  }
}

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const notifications = await listBusinessNotifications(auth.businessId);
  return NextResponse.json({ ok: true, notifications });
}

/** Mark all as read (PATCH) so the unread badge clears when the panel opens. */
export async function PATCH(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await markAllNotificationsRead({
    audience: "business",
    businessId: auth.businessId,
  });
  return NextResponse.json({ ok: true });
}

/** Clear all notifications for this business. */
export async function DELETE(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await deleteAllNotifications({
    audience: "business",
    businessId: auth.businessId,
  });
  return NextResponse.json({ ok: true });
}
