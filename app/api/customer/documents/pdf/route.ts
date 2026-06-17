import { authenticateCustomerRequest } from "@/lib/customer/server";
import { getCustomerDocumentPdf } from "@/lib/customer/document-pdf";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateCustomerRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { searchParams } = new URL(request.url);
  const requestId = searchParams.get("requestId")?.trim() ?? "";
  const kind = searchParams.get("kind")?.trim() ?? "";

  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: "Request id is required." },
      { status: 400 },
    );
  }

  if (kind !== "quotation" && kind !== "invoice") {
    return NextResponse.json(
      { ok: false, error: 'Document kind must be "quotation" or "invoice".' },
      { status: 400 },
    );
  }

  const result = await getCustomerDocumentPdf(requestId, kind, {
    customerId: auth.customer.uid,
    customerEmail: auth.customer.email,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return new NextResponse(Uint8Array.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.fileName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
