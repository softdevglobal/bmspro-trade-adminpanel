import type { MailboxFolder } from "@/lib/email-integration/types";

import type { ActionContext, ActionHandler } from "./context";

/** Actions on the email itself: move it to a folder, mark it read. */

const NEEDS_MAILBOX = "Reconnect your mailbox, with permission to organise it, and I'll do this next time.";

function target(context: ActionContext) {
  const message = context.message;
  if (!message) return null;
  return {
    connectionId: String(message.connectionId ?? ""),
    id: String(message.providerMessageId ?? ""),
    threadId: String(message.threadId ?? ""),
    folder: (message.folder ?? "inbox") as MailboxFolder,
    messageIdHeader: String(message.messageIdHeader ?? ""),
  };
}

export const moveFolder: ActionHandler = {
  async run(context) {
    if (context.action.kind !== "move_folder") throw new Error("Wrong action.");
    const folder = context.action.folder;
    const email = target(context);
    if (!email) return { status: "skipped", summary: "The email is no longer in the mailbox." };
    if (email.folder !== "inbox") return { status: "skipped", summary: "It's already out of the Inbox." };
    const mailbox = await context.deps.mailbox(context.businessId, email.connectionId);
    if (!mailbox) return { status: "needs_details", summary: NEEDS_MAILBOX };
    await mailbox.moveToFolder([email.id], folder);
    await mailbox.refresh([email.id]);
    return {
      status: "done",
      summary: `Moved it to "${folder}".`,
      undo: { connectionId: email.connectionId, id: email.id, messageIdHeader: email.messageIdHeader, folder },
    };
  },
  async undo(context, data) {
    const mailbox = await context.deps.mailbox(context.businessId, String(data.connectionId));
    if (!mailbox) throw new Error(NEEDS_MAILBOX);
    const id = String(data.id);
    await mailbox.restoreToInbox([{ id, messageIdHeader: String(data.messageIdHeader ?? "") }], String(data.folder));
    await mailbox.refresh([id]);
    return "Moved it back to the Inbox.";
  },
};

export const markRead: ActionHandler = {
  async run(context) {
    const email = target(context);
    if (!email) return { status: "skipped", summary: "The email is no longer in the mailbox." };
    if (context.message?.unread === false) return { status: "skipped", summary: "It was already read." };
    const mailbox = await context.deps.mailbox(context.businessId, email.connectionId);
    if (!mailbox) return { status: "needs_details", summary: NEEDS_MAILBOX };
    await mailbox.setRead(email, true);
    await mailbox.refresh([email.id]);
    return { status: "done", summary: "Marked it as read.", undo: { ...email } };
  },
  async undo(context, data) {
    const mailbox = await context.deps.mailbox(context.businessId, String(data.connectionId));
    if (!mailbox) throw new Error(NEEDS_MAILBOX);
    const id = String(data.id);
    await mailbox.setRead({ id, threadId: String(data.threadId), folder: (data.folder ?? "inbox") as MailboxFolder }, false);
    await mailbox.refresh([id]);
    return "Marked it unread again.";
  },
};
