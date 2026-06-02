import { adminAuth } from "@/lib/firebase/admin";
import {
  createQuotationForInspection,
  listQuotationsForInspection,
} from "@/lib/quotations/server";
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
        error: "You do not have permission to create quotations.",
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
  const auth = await requireQuotationAuthor(request);
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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const inspectionRequestId =
    typeof payload.inspectionRequestId === "string"
      ? payload.inspectionRequestId
      : "";
  const lineItems = payload.lineItems;
  const additions = payload.additions;
  const finalPriceAud =
    typeof payload.finalPriceAud === "number" &&
    Number.isFinite(payload.finalPriceAud)
      ? payload.finalPriceAud
      : null;
  const notes = typeof payload.notes === "string" ? payload.notes : null;
  const validUntil =
    typeof payload.validUntil === "string" ? payload.validUntil : null;
  const imageUrls = payload.imageUrls;

  const result = await createQuotationForInspection(
    auth.businessId,
    auth.uid,
    {
      inspectionRequestId,
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      additions: Array.isArray(additions) ? additions : [],
      finalPriceAud,
      notes,
      validUntil,
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, quotation: result.quotation });
}

/** Lists quotations for an inspection request (admin viewing). */
export async function GET(request: Request) {
  const auth = await requireQuotationAuthor(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const inspectionRequestId =
    url.searchParams.get("inspectionRequestId")?.trim() ?? "";
  if (!inspectionRequestId) {
    return NextResponse.json(
      { ok: false, error: "Missing inspectionRequestId." },
      { status: 400 },
    );
  }

  const quotations = await listQuotationsForInspection(
    auth.businessId,
    inspectionRequestId,
  );

  return NextResponse.json({ ok: true, quotations });
}
