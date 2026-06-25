import { adminAuth } from "@/lib/firebase/admin";
import { getBusinessQuotationPdf } from "@/lib/quotations/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireQuotationReader(request: Request) {
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
        error: "You do not have permission to view quotations.",
      };
    }

    return {
      ok: true as const,
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
  const auth = await requireQuotationReader(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { searchParams } = new URL(request.url);
  const quotationId = searchParams.get("quotationId")?.trim() ?? "";
  if (!quotationId) {
    return NextResponse.json(
      { ok: false, error: "Quotation is required." },
      { status: 400 },
    );
  }

  const result = await getBusinessQuotationPdf(auth.businessId, quotationId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return new NextResponse(new Uint8Array(result.pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.fileName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
