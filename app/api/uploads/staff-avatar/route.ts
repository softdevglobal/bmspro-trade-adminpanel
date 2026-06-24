/**
 * Staff avatar upload API.
 *
 * POST — Accepts a multipart form with `file` and an optional `staffId`. Stores
 *        the photo in Firebase Storage and returns a public HTTPS imageUrl.
 *
 * Auth: business owners/admins only. The image is scoped to their business so a
 * team member's profile photo can surface across the web app, mobile admin, and
 * the customer portal.
 */

import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { uploadStaffAvatar } from "@/lib/onboarding/services/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await requireBusinessOwner(request);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid upload request." },
        { status: 400 },
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Please choose a photo." },
        { status: 400 },
      );
    }

    const staffIdValue = formData.get("staffId");
    const staffId =
      typeof staffIdValue === "string" && staffIdValue.trim()
        ? staffIdValue.trim()
        : null;

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadStaffAvatar(buffer, file.type || "", {
      businessId: auth.businessId,
      staffId,
      filename: file.name || "staff-avatar.jpg",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ok: true, imageUrl: result.imageUrl });
  } catch (error) {
    console.error("POST /api/uploads/staff-avatar failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not upload photo." },
      { status: 500 },
    );
  }
}
