import { NextResponse } from "next/server";

import { adminAuth } from "@/lib/firebase/admin";
import { sendStaffMobilePush } from "@/lib/notifications/push";

export const runtime = "nodejs";

async function requireAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false as const, status: 401, error: "Missing authorization header." };
  }
  try {
    await adminAuth.verifyIdToken(match[1]);
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid or expired session." };
  }
}

/** Stringifies a data payload for FCM, which requires Record<string, string>. */
function toStringData(data: unknown): Record<string, string> {
  if (!data || typeof data !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

/**
 * Client-triggered FCM push endpoint used by the mobile app for flows that
 * originate on-device (booking status changes, staff assignment, walk-in
 * bookings, auto clock-out) rather than from server-side business logic.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const targetUid =
    (typeof body.targetUid === "string" && body.targetUid.trim()) ||
    (typeof body.staffUid === "string" && body.staffUid.trim()) ||
    null;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const message =
    (typeof body.message === "string" && body.message.trim()) ||
    (typeof body.body === "string" && body.body.trim()) ||
    "";

  if (!targetUid || !title || !message) {
    return NextResponse.json(
      { success: false, error: "targetUid, title, and message are required." },
      { status: 400 },
    );
  }

  await sendStaffMobilePush({
    uid: targetUid,
    title,
    body: message,
    data: toStringData(body.data),
  });

  return NextResponse.json({ success: true });
}
