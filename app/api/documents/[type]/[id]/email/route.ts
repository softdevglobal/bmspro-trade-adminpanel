/**
 * GET  — send-dialog defaults: sender, recipient, subject, body, totals and the
 *        document version the send must match.
 * POST — queues the email. Requires an Idempotency-Key header; returns 202 with
 *        the outbox id. Recipients, content and PDF are frozen at queue time.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  getBusinessEmailConnection,
  toConnectionSummary,
} from "@/lib/email-integration/connections";
import {
  attachmentNameFor,
  defaultEmailContent,
  documentSendBlocker,
  loadEmailableDocument,
  parseDocumentType,
} from "@/lib/email-integration/documents";
import {
  enqueueDocumentEmail,
  parseIdempotencyKey,
  processOutboxItem,
} from "@/lib/email-integration/outbox";
import type { EmailSendPreview } from "@/lib/email-integration/types";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/documents/[type]/[id]/email">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { type: rawType, id } = await ctx.params;
  const type = parseDocumentType(rawType);
  if (!type) return emailError(404, "Unknown document type.");

  const document = await loadEmailableDocument(auth.businessId, type, id);
  if (!document) return emailError(404, "Document not found.");
  const blocker = documentSendBlocker(document);
  if (blocker) return emailError(409, blocker, "not_sendable");

  const connection = await getBusinessEmailConnection(auth.businessId);
  const content = defaultEmailContent(document);
  const preview: EmailSendPreview = {
    connection: connection ? toConnectionSummary(connection) : null,
    documentType: type,
    documentId: document.id,
    documentVersion: document.version,
    documentCode: document.code,
    customerName: document.customerName,
    to: document.customerEmail ? [document.customerEmail] : [],
    subject: content.subject,
    bodyText: content.bodyText,
    totalAud: document.totalAud,
    balanceDueAud: document.balanceDueAud,
    attachmentName: attachmentNameFor(document),
    documentLink: document.payUrl,
  };
  return NextResponse.json({ ok: true, preview });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/documents/[type]/[id]/email">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { type: rawType, id } = await ctx.params;
  const type = parseDocumentType(rawType);
  if (!type) return emailError(404, "Unknown document type.");

  const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotencyKey) {
    return emailError(400, "A valid Idempotency-Key header is required.");
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return emailError(400, "Invalid request body.");

  const result = await enqueueDocumentEmail({
    businessId: auth.businessId,
    actorId: auth.uid,
    idempotencyKey,
    connectionId: body.connection_id,
    documentType: type,
    documentId: id,
    documentVersion: body.document_version,
    to: body.to,
    cc: body.cc,
    subject: body.subject,
    bodyText: body.body_text,
  });
  if (!result.ok) return emailError(result.status, result.error, result.code);

  if (result.created) {
    after(() => processOutboxItem(result.outboxId).catch(() => undefined));
  }
  return NextResponse.json(
    { ok: true, outbox_id: result.outboxId, status: result.status },
    { status: 202 },
  );
}
