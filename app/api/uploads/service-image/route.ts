/**
 * Service image upload API.
 *
 * POST — Accepts multipart form with `file` and `scope` (service-templates | services).
 *        Stores in Firebase Storage and returns a public HTTPS imageUrl.
 */

import { requireSession } from "@/lib/onboarding/services/server";
import { uploadServiceImage } from "@/lib/onboarding/services/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Uploads a service or template image; scope determines storage path and auth rules. */
export async function POST(request: Request) {
  try {
    const auth = await requireSession(request);
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
    const scope = formData.get("scope");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Please choose an image file." },
        { status: 400 },
      );
    }

    if (scope !== "service-templates" && scope !== "services") {
      return NextResponse.json(
        { ok: false, error: "Invalid upload scope." },
        { status: 400 },
      );
    }

    if (scope === "services" && auth.role !== "business_owner") {
      return NextResponse.json(
        { ok: false, error: "Business owner access required." },
        { status: 403 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadServiceImage(buffer, file.type || "image/jpeg", {
      scope,
      uid: auth.uid,
      businessId:
        auth.role === "business_owner" ? auth.businessId : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ok: true, imageUrl: result.imageUrl });
  } catch (error) {
    console.error("POST /api/uploads/service-image failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not upload image." },
      { status: 500 },
    );
  }
}
