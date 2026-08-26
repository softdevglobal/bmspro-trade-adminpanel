import { getCatalogItemDocument } from "@/lib/items/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Streams a catalog item's attached PDF.
 *
 * Exists because Firebase Storage serves no CORS headers for the app's origin,
 * so the browser cannot fetch the document URL directly — the same proxy
 * quotation and invoice PDFs already use. Readable by any business member:
 * assigned staff need item safety sheets on an ongoing job.
 */
export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("itemId")?.trim() ?? "";
  if (!itemId) {
    return NextResponse.json(
      { ok: false, error: "Item is required." },
      { status: 400 },
    );
  }

  const result = await getCatalogItemDocument(auth.businessId, itemId);
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
