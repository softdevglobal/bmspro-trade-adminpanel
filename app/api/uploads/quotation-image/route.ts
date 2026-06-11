import { adminAuth } from "@/lib/firebase/admin";
import { uploadQuotationAttachment } from "@/lib/onboarding/services/upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireQuotationAuthor(request: Request) {
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
    if (
      !businessId ||
      (role !== "staff" && role !== "owner" && role !== "admin")
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "You do not have permission to upload quotation attachments.",
      };
    }

    return {
      ok: true as const,
      uid: decoded.uid,
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

export async function POST(request: Request) {
  try {
    const auth = await requireQuotationAuthor(request);
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
    const inspectionRequestId =
      formData.get("requestId") ?? formData.get("inspectionRequestId");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Please choose a file." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadQuotationAttachment(buffer, file.type || "", {
      businessId: auth.businessId,
      uid: auth.uid,
      filename: file.name || "photo.jpg",
      inspectionRequestId:
        typeof inspectionRequestId === "string"
          ? inspectionRequestId
          : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({ ok: true, imageUrl: result.imageUrl });
  } catch (error) {
    console.error("POST /api/uploads/quotation-image failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not upload file." },
      { status: 500 },
    );
  }
}
