import type { ActionHandler } from "./context";

/**
 * Send the quote or invoice again (docs/sophie-email-learning-and-auto-reply.md step 8b, §9.1):
 * the platform's own document email, for the document whose thread this email replies in.
 *
 * Only for a verified customer replying in that thread (`verified_thread`), and only to the address
 * on the document, which must be the one asking. The email is the platform's own, unchanged, with
 * the document's current version. An email can't be unsent, so there's no Undo.
 */

const SUMMARY: Record<string, string> = {
  not_found: "I didn't send it again: the document isn't there any more.",
  address_mismatch: "I didn't send it again: the address on the document isn't the one asking. Check it and send it yourself.",
  not_sendable: "I didn't send it again: it can't be emailed as it is. Open it to check.",
  needs_reconnect: "I didn't send it again: reconnect your mailbox, then send it yourself.",
};

export const resendDocument: ActionHandler = {
  async run(context) {
    const { deps, businessId, triage, message } = context;
    if (!message) return { status: "skipped", summary: "The email is no longer in the mailbox." };
    const document = triage.platformDocument as { type?: unknown; id?: unknown; code?: unknown } | null | undefined;
    const type = document?.type === "quote" || document?.type === "invoice" ? document.type : null;
    if (!type || typeof document?.id !== "string" || !document.id) {
      return { status: "manual", summary: "I didn't send anything: this email isn't a reply to one of your quotes or invoices." };
    }
    if (triage.identity !== "verified_thread") {
      return { status: "manual", summary: "I only send documents again to a verified customer replying to our email. Send it yourself if it's right." };
    }
    const requester = typeof message.fromAddress === "string" ? message.fromAddress.trim().toLowerCase() : "";
    const result = await deps.resendDocument({
      businessId,
      connectionId: String(message.connectionId ?? ""),
      documentType: type,
      documentId: document.id,
      requester,
      idempotencyKey: `sophie-resend-${context.triageId}`,
      actorUid: context.actorUid,
    });
    const label = type === "quote" ? "the quote" : "the invoice";
    if (result.ok) return { status: "done", summary: `Sent ${result.code || label} again to ${requester}.` };
    // A retry after it was already queued (the document changed since): it went the first time.
    if (result.reason === "already_queued") return { status: "done", summary: `Sent ${label} again to ${requester}.` };
    if (result.reason === "failed") throw new Error("resend_not_queued");
    return { status: "manual", summary: SUMMARY[result.reason] };
  },
};
