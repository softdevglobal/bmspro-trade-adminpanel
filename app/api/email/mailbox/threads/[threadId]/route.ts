/**
 * GET — every message of one conversation with its body fetched from Gmail on
 * demand: plain text, plus sanitised HTML for the sandboxed preview frame.
 * Bodies are never stored.
 */

import { emailError } from "@/lib/email-integration/auth";
import {
  MAILBOX_BODY_MAX_CHARS,
  MAILBOX_THREAD_MAX_MESSAGES,
} from "@/lib/email-integration/config";
import { getMessageBody, GmailReadError } from "@/lib/email-integration/mailbox/gmail";
import { requireMailbox } from "@/lib/email-integration/mailbox/access";
import { listThreadMessages, toSummary } from "@/lib/email-integration/mailbox/store";
import type { MailboxThreadMessage } from "@/lib/email-integration/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/email/mailbox/threads/[threadId]">,
) {
  const { threadId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(threadId)) return emailError(404, "Conversation not found.");

  const gate = await requireMailbox(request, { capability: "read", credentials: true });
  if (!gate.ok) return gate.response;

  const stored = await listThreadMessages({
    connectionId: gate.connection.id,
    threadId,
    limit: MAILBOX_THREAD_MAX_MESSAGES,
  });
  if (stored.length === 0) return emailError(404, "Conversation not found.");

  const messages: MailboxThreadMessage[] = await Promise.all(
    stored.map(async (message) => {
      const { providerMessageId } = message;
      const summary = toSummary(message);
      try {
        const body = await getMessageBody(gate.credentials!, providerMessageId, MAILBOX_BODY_MAX_CHARS);
        return {
          ...summary,
          bodyText: body?.text ?? null,
          bodyHtml: body?.html ?? null,
          attachments: body?.attachments ?? [],
          bodyError: body ? null : "This message is no longer in Gmail.",
        };
      } catch (error) {
        return {
          ...summary,
          bodyText: null,
          bodyHtml: null,
          attachments: [],
          bodyError:
            error instanceof GmailReadError && error.code === "read_not_authorised"
              ? "Inbox access was removed. Enable it again to read messages."
              : "Couldn't load this message. Try again.",
        };
      }
    }),
  );
  return NextResponse.json({ ok: true, messages });
}
