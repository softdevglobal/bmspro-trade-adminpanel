import { adminAuth } from "@/lib/firebase/admin";
import {
  deleteNotification,
  markNotificationRead,
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;
  const ok = await markNotificationRead(id, {
    audience: "business",
    businessId: auth.businessId,
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Notification not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** Clear a single notification. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;
  const ok = await deleteNotification(id, {
    audience: "business",
    businessId: auth.businessId,
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Notification not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
