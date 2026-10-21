/**
 * GET ?cursor= — cursor-paginated email send history for one document.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  loadEmailableDocument,
  parseDocumentType,
} from "@/lib/email-integration/documents";
import { listDocumentEmailHistory } from "@/lib/email-integration/outbox";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/documents/[type]/[id]/emails">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { type: rawType, id } = await ctx.params;
  const type = parseDocumentType(rawType);
  if (!type) return emailError(404, "Unknown document type.");

  // Confirms the document belongs to this business before listing anything.
  const document = await loadEmailableDocument(auth.businessId, type, id);
  if (!document) return emailError(404, "Document not found.");

  const cursor = new URL(request.url).searchParams.get("cursor");
  const history = await listDocumentEmailHistory({
    businessId: auth.businessId,
    documentType: type,
    documentId: document.id,
    cursor: cursor?.trim() || null,
  });
  return NextResponse.json({ ok: true, ...history });
}
