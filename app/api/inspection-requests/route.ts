import { adminAuth } from "@/lib/firebase/admin";
import {
  createInspectionRequest,
  listInspectionRequests,
} from "@/lib/inspection/server";
import { parseInspectionRequestInput } from "@/lib/inspection/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireBusinessOwner(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing authorization header.",
    };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (!businessId || (role !== "owner" && role !== "admin")) {
      return {
        ok: false as const,
        status: 403,
        error: "Business owner access required.",
      };
    }
    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email,
      businessId,
    };
  } catch {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid or expired session.",
    };
  }
}

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const requests = await listInspectionRequests(auth.businessId);
  return NextResponse.json({ ok: true, requests });
}

/** Owner-authenticated create (mobile app / dashboard walk-in). */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
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

  const parsed = parseInspectionRequestInput(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const result = await createInspectionRequest(auth.businessId, parsed.value, {
    customerId: null,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true, request: result.request });
}
