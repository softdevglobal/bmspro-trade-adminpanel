import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { createInspectionRequest } from "@/lib/inspection/server";
import { parseInspectionRequestInput } from "@/lib/inspection/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function readCustomerUid(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

async function resolveBusinessIdFromSlug(slug: string): Promise<string | null> {
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const slug =
    body && typeof body === "object" && "slug" in body
      ? String((body as Record<string, unknown>).slug ?? "").trim()
      : "";
  if (!slug) {
    return NextResponse.json(
      { ok: false, error: "Booking link is invalid." },
      { status: 400 },
    );
  }

  const parsed = parseInspectionRequestInput(body);
  if (!parsed.ok) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const businessId = await resolveBusinessIdFromSlug(slug);
  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "Business not found." },
      { status: 404 },
    );
  }

  const customerId = await readCustomerUid(request);

  const result = await createInspectionRequest(businessId, parsed.value, {
    customerId,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json({ ok: true, requestId: result.request.id });
}
