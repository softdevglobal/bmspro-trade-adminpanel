import { requireBusinessMember } from "@/lib/onboarding/server";
import {
  dismissAllBroadcasts,
  listBroadcastsForUser,
  markAllBroadcastsRead,
} from "@/lib/broadcasts/server";
import { isValidPlatform, type BroadcastPlatform } from "@/lib/broadcasts/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function resolvePlatform(request: Request): BroadcastPlatform {
  const value = new URL(request.url).searchParams.get("platform");
  return isValidPlatform(value) ? value : "mobile";
}

/** List active broadcasts targeting this caller (owner or staff). */
export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const broadcasts = await listBroadcastsForUser(
    auth.uid,
    auth.role,
    resolvePlatform(request),
  );
  return NextResponse.json({ ok: true, broadcasts });
}

/** Mark every broadcast visible to this caller as read. */
export async function PATCH(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await markAllBroadcastsRead(auth.uid, auth.role, resolvePlatform(request));
  return NextResponse.json({ ok: true });
}

/** Dismiss (hide) every broadcast visible to this caller. */
export async function DELETE(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await dismissAllBroadcasts(auth.uid, auth.role, resolvePlatform(request));
  return NextResponse.json({ ok: true });
}
