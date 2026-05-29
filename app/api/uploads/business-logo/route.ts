/**
 * Business logo upload API.
 *
 * POST — Accepts a multipart form with `file`. Stores the logo in Firebase
 *        Storage and returns a public HTTPS imageUrl.
 *
 * Auth: super admins and business owners upload under their business path.
 * Public onboarding (self-signup, no account yet) is allowed and stored under
 * a shared `onboarding` prefix — logos are public assets and size/type limited.
 */

import { requireSession } from "@/lib/onboarding/services/server";
import { uploadBusinessLogo } from "@/lib/onboarding/services/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
      { ok: false, error: "Please choose a logo image." },
      { status: 400 },
    );
  }

  // Authenticated owners/admins store under their business; onboarding is public.
  const auth = await requireSession(request);
  const businessId =
    auth.ok && auth.role === "business_owner" ? auth.businessId : null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await uploadBusinessLogo(buffer, file.type || "image/png", {
    businessId,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ ok: true, imageUrl: result.imageUrl });
}
