/**
 * POST { action } — Gmail-side changes to a whole conversation: read/unread,
 * star, archive, back to Inbox, trash or restore. Needs gmail.modify. The
 * stored copies are refreshed straight away so every view updates.
 */

import { emailError } from "@/lib/email-integration/auth";
import { recordEmailEvent } from "@/lib/email-integration/events";
import {
  GmailReadError,
  modifyThreadLabels,
  trashThread,
  untrashThread,
} from "@/lib/email-integration/mailbox/gmail";
import { requireMailbox } from "@/lib/email-integration/mailbox/access";
import { listThreadMessages } from "@/lib/email-integration/mailbox/store";
import { refreshMessageLabels } from "@/lib/email-integration/mailbox/sync";
import type { MailboxAction } from "@/lib/email-integration/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ACTIONS: MailboxAction[] = [
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
  "archive",
  "move_to_inbox",
  "trash",
  "untrash",
];

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/email/mailbox/threads/[threadId]/actions">,
) {
  const { threadId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(threadId)) return emailError(404, "Conversation not found.");

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = ACTIONS.find((item) => item === body?.action);
  if (!action) return emailError(400, "Unknown action.");

  const gate = await requireMailbox(request, { capability: "modify", credentials: true });
  if (!gate.ok) return gate.response;

  // Only conversations already shown on the platform can be changed from here.
  const stored = await listThreadMessages({
    connectionId: gate.connection.id,
    threadId,
    limit: 100,
  });
  if (stored.length === 0) return emailError(404, "Conversation not found.");

  const credentials = gate.credentials!;
  try {
    switch (action) {
      case "mark_read":
        await modifyThreadLabels(credentials, threadId, { remove: ["UNREAD"] });
        break;
      case "mark_unread":
        await modifyThreadLabels(credentials, threadId, { add: ["UNREAD"] });
        break;
      case "star":
        await modifyThreadLabels(credentials, threadId, { add: ["STARRED"] });
        break;
      case "unstar":
        await modifyThreadLabels(credentials, threadId, { remove: ["STARRED"] });
        break;
      case "archive":
        await modifyThreadLabels(credentials, threadId, { remove: ["INBOX"] });
        break;
      case "move_to_inbox":
        if (stored.some((message) => message.folder === "trash")) {
          await untrashThread(credentials, threadId);
        }
        await modifyThreadLabels(credentials, threadId, { add: ["INBOX"] });
        break;
      case "trash":
        await trashThread(credentials, threadId);
        break;
      case "untrash":
        await untrashThread(credentials, threadId);
        break;
    }
  } catch (error) {
    if (error instanceof GmailReadError && error.code === "read_not_authorised") {
      return emailError(409, "Allow mailbox management to use this action.", "needs_modify");
    }
    return emailError(502, "Gmail didn't accept that change. Try again.");
  }

  await refreshMessageLabels(
    gate.connection,
    credentials,
    stored.map((message) => message.providerMessageId),
  );
  if (action === "trash" || action === "untrash" || action === "archive" || action === "move_to_inbox") {
    await recordEmailEvent({
      businessId: gate.businessId,
      eventType: "mailbox_action",
      connectionId: gate.connection.id,
      actorId: gate.uid,
      safeErrorDetail: action,
    });
  }
  return NextResponse.json({ ok: true });
}
