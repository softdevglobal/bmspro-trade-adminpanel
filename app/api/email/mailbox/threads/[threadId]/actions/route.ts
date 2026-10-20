/**
 * POST { action } — provider-side changes to a whole conversation: read/unread,
 * star, archive, back to Inbox, trash or restore. Needs organise access
 * (gmail.modify / Mail.ReadWrite). The stored copies are refreshed straight
 * away so every view updates.
 */

import { emailError } from "@/lib/email-integration/auth";
import { recordEmailEvent } from "@/lib/email-integration/events";
import { providerIdParam, requireMailbox } from "@/lib/email-integration/mailbox/access";
import { MailboxReadError } from "@/lib/email-integration/mailbox/provider";
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
  const threadId = providerIdParam((await ctx.params).threadId);
  if (!threadId) return emailError(404, "Conversation not found.");

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
  const own = gate.connection.address.toLowerCase();
  try {
    await gate.adapter.threadAction(
      credentials,
      threadId,
      action,
      stored.map((message) => ({
        id: message.providerMessageId,
        folder: message.folder,
        fromSelf: message.fromAddress.toLowerCase() === own,
      })),
    );
  } catch (error) {
    if (error instanceof MailboxReadError && error.code === "read_not_authorised") {
      return emailError(409, "Allow mailbox management to use this action.", "needs_modify");
    }
    return emailError(502, "Your email provider didn't accept that change. Try again.");
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
