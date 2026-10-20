/**
 * GET — downloads one attachment of a message shown on the platform. Always
 * served as a download (never rendered inline) with sniffing disabled.
 */

import { emailError } from "@/lib/email-integration/auth";
import { providerIdParam, requireMailbox } from "@/lib/email-integration/mailbox/access";
import { getStoredMessage } from "@/lib/email-integration/mailbox/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/email/mailbox/messages/[messageId]/attachments/[attachmentId]">,
) {
  const params = await ctx.params;
  const messageId = params.messageId;
  const attachmentId = providerIdParam(params.attachmentId, 1024);
  if (!attachmentId) return emailError(404, "Attachment not found.");

  const gate = await requireMailbox(request, { capability: "read", credentials: true });
  if (!gate.ok) return gate.response;

  const stored = await getStoredMessage(gate.connection.id, messageId);
  if (!stored) return emailError(404, "Attachment not found.");

  // Confirm the attachment belongs to this message and take its real name.
  const body = await gate.adapter.getBody(gate.credentials!, stored.providerMessageId, 1);
  const meta = body?.attachments.find((item) => item.attachmentId === attachmentId);
  if (!meta) return emailError(404, "Attachment not found.");
  if (meta.size > MAX_DOWNLOAD_BYTES) return emailError(413, "This attachment is too large to download here.");

  const bytes = await gate.adapter.getAttachment(gate.credentials!, stored.providerMessageId, attachmentId);
  const asciiName = meta.name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
