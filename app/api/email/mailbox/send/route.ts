/**
 * POST multipart/form-data — sends a new email, reply or forward from the
 * connected mailbox through the outbox.
 *   payload: JSON { intent: "new"|"reply"|"forward", to, cc, bcc, subject,
 *            body_text, reply_to_message_id?, forward_message_id?,
 *            include_original_attachments? }
 *   attachments: files (up to 4 MB in total from the browser)
 * Header: Idempotency-Key. Returns 202 { outbox_id, status }.
 */

import { emailError } from "@/lib/email-integration/auth";
import {
  MAILBOX_ATTACHMENTS_MAX_BYTES,
  MAILBOX_UPLOAD_MAX_BYTES,
} from "@/lib/email-integration/config";
import { getAttachment, getMessageBody } from "@/lib/email-integration/mailbox/gmail";
import { requireMailbox } from "@/lib/email-integration/mailbox/access";
import { replyReferences } from "@/lib/email-integration/mailbox/parse";
import { getStoredMessage } from "@/lib/email-integration/mailbox/store";
import { syncMailbox } from "@/lib/email-integration/mailbox/sync";
import {
  enqueueMailboxMessage,
  parseIdempotencyKey,
  processOutboxItem,
  type MailboxAttachmentInput,
} from "@/lib/email-integration/outbox";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Payload = {
  intent?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body_text?: unknown;
  reply_to_message_id?: unknown;
  forward_message_id?: unknown;
  include_original_attachments?: unknown;
};

export async function POST(request: Request) {
  const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!idempotencyKey) return emailError(400, "A valid Idempotency-Key header is required.");

  const gate = await requireMailbox(request, { capability: "send" });
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return emailError(400, "Invalid request body.");
  }
  let payload: Payload;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "")) as Payload;
  } catch {
    return emailError(400, "Invalid request body.");
  }
  const intent =
    payload.intent === "reply" || payload.intent === "forward" ? payload.intent : "new";

  const attachments: MailboxAttachmentInput[] = [];
  let uploaded = 0;
  for (const entry of form.getAll("attachments")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    uploaded += entry.size;
    if (uploaded > MAILBOX_UPLOAD_MAX_BYTES) {
      return emailError(413, "Attachments from your computer can be up to 4 MB in total.");
    }
    attachments.push({
      name: entry.name || "attachment",
      contentType: entry.type || "application/octet-stream",
      content: Buffer.from(await entry.arrayBuffer()),
    });
  }

  let thread: { providerThreadId: string; inReplyTo: string; references: string } | null = null;
  const sourceId =
    intent === "reply"
      ? payload.reply_to_message_id
      : intent === "forward"
        ? payload.forward_message_id
        : null;
  if (intent !== "new") {
    // Replies and forwards need the original, which needs mailbox read access.
    const readGate = await requireMailbox(request, { capability: "read", credentials: true });
    if (!readGate.ok) return readGate.response;
    const source =
      typeof sourceId === "string" ? await getStoredMessage(gate.connection.id, sourceId) : null;
    if (!source) return emailError(404, "The original email was not found.");

    if (intent === "reply") {
      thread = {
        providerThreadId: source.threadId,
        inReplyTo: source.messageIdHeader,
        references: replyReferences(source.references, source.messageIdHeader),
      };
    } else if (payload.include_original_attachments === true) {
      const body = await getMessageBody(readGate.credentials!, source.providerMessageId, 1);
      let total = attachments.reduce((sum, file) => sum + file.content.length, 0);
      for (const item of body?.attachments ?? []) {
        if (!item.attachmentId) continue;
        total += item.size;
        if (total > MAILBOX_ATTACHMENTS_MAX_BYTES) {
          return emailError(422, "The original attachments are too large to forward from here.");
        }
        attachments.push({
          name: item.name,
          contentType: item.mimeType,
          content: await getAttachment(readGate.credentials!, source.providerMessageId, item.attachmentId),
        });
      }
    }
  }

  const result = await enqueueMailboxMessage({
    businessId: gate.businessId,
    actorId: gate.uid,
    idempotencyKey,
    connection: gate.connection,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    bodyText: payload.body_text,
    attachments,
    thread,
    intent,
  });
  if (!result.ok) return emailError(result.status, result.error, result.code);

  if (result.created) {
    after(async () => {
      const status = await processOutboxItem(result.outboxId).catch(() => null);
      // Bring the sent copy into Sent right away when the mailbox is synced.
      if (status === "accepted" && gate.connection.capabilities.includes("read")) {
        await syncMailbox(gate.connection).catch(() => undefined);
      }
    });
  }
  return NextResponse.json(
    { ok: true, outbox_id: result.outboxId, status: result.status },
    { status: 202 },
  );
}
