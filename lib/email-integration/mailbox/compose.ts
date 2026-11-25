/**
 * The prefilled fields of a new email, reply or forward. Shared by the composer popup
 * (components/mail-composer.tsx) and Sophie's MCP send (prepare_email_send), so a reply or
 * forward prepared by voice has the same recipients, subject and quoted text as one opened
 * on the page. Pure: safe in the browser and on the server.
 */
import {
  extractAddresses,
  forwardBlock,
  forwardSubject,
  quoteForReply,
  replySubject,
} from "@/lib/email-integration/mailbox/parse";
import type { MailboxThreadMessage } from "@/lib/email-integration/types";

export type ComposerDraft =
  | { intent: "new"; to?: string[] }
  | { intent: "reply"; replyAll: boolean; source: MailboxThreadMessage }
  | { intent: "forward"; source: MailboxThreadMessage };

/** Same rule as the composer's address check. */
export const EMAIL_ADDRESS_PATTERN = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

export function formatComposerDate(timestamp: number | null, timeZone?: string): string {
  return timestamp
    ? new Date(timestamp).toLocaleString("en-AU", {
        timeZone,
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

function sender(message: MailboxThreadMessage): string {
  return message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress;
}

/** Prefilled recipients, subject and body for a new email, reply or forward. */
export function composerInitialFields(draft: ComposerDraft, ownAddress: string, timeZone?: string) {
  const own = ownAddress.toLowerCase();
  if (draft.intent === "new") {
    return { to: draft.to ?? [], cc: [] as string[], subject: "", body: "" };
  }
  const source = draft.source;
  const text = source.bodyText ?? "";
  if (draft.intent === "forward") {
    return {
      to: [] as string[],
      cc: [] as string[],
      subject: forwardSubject(source.subject),
      body: forwardBlock({
        from: sender(source),
        date: formatComposerDate(source.date, timeZone),
        subject: source.subject.trim(),
        to: source.to,
        cc: source.cc,
        bodyText: text,
      }),
    };
  }
  // Replying to our own sent message goes back to its recipients.
  const fromSelf = source.fromAddress.toLowerCase() === own;
  const primary = (fromSelf ? extractAddresses(source.to) : [source.fromAddress.toLowerCase()]).filter(
    (address) => address !== own,
  );
  const others = draft.replyAll
    ? extractAddresses(source.to, source.cc).filter(
        (address) => address !== own && !primary.includes(address),
      )
    : [];
  return {
    to: primary,
    cc: others,
    subject: replySubject(source.subject),
    body: quoteForReply({ from: sender(source), date: formatComposerDate(source.date, timeZone), bodyText: text }),
  };
}

/** Where the quoted original starts in a reply or forward body ("On … wrote:" or the forward header). */
const QUOTE_START = /\n\nOn [^\n]*wrote:\n|\n\n---------- Forwarded message ---------\n/;

/** Splits a body into what the owner wrote and the quoted original below it. */
export function splitQuoted(body: string): { written: string; quoted: string } {
  const match = QUOTE_START.exec(body);
  if (!match) return { written: body, quoted: "" };
  return { written: body.slice(0, match.index), quoted: body.slice(match.index) };
}
