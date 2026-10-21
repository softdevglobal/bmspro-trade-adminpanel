import { boundedUploadForm } from "@/lib/security/upload-request";
import { clientAddress, consumeRateLimits } from "@/lib/security/rate-limit";
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
  try {
    if (!(await consumeRateLimits([
      { key: "uploads:logo:ip:" + clientAddress(request), limit: 20, windowMs: 3600_000 },
      { key: "uploads:logo:global", limit: 1000, windowMs: 86400_000 },
    ]))) return NextResponse.json({ error: "Upload limit reached. Please try later." }, { status: 429 });
  } catch { return NextResponse.json({ error: "Upload service temporarily unavailable." }, { status: 503 }); }
  let formData: FormData;
  try {
    formData = await boundedUploadForm(request);
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
  if (request.headers.has("authorization") && !auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
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
