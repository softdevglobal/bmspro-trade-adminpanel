import type { MailboxFolder } from "@/lib/email-integration/types";

/**
 * Folder a Gmail message is shown in. Drafts and spam are never shown; Sent
 * wins over Inbox for mail the business sent itself.
 */
export function folderFromLabels(labels: string[]): MailboxFolder | null {
  if (labels.includes("DRAFT") || labels.includes("SPAM")) return null;
  if (labels.includes("TRASH")) return "trash";
  if (labels.includes("SENT")) return "sent";
  if (labels.includes("INBOX")) return "inbox";
  return "archive";
}

/** Splits `Name <addr@x.com>` / bare addresses; falls back to the raw text. */
export function parseSender(raw: string): { name: string | null; address: string } {
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim() || null, address: match[2].trim().toLowerCase() };
  }
  return { name: null, address: raw.trim().toLowerCase() };
}

const ADDRESS_IN_HEADER = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[^\s<>"'(),;:]+/g;

/** Every address in a From/To/Cc header, lowercased and de-duplicated. */
export function extractAddresses(...headers: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const header of headers) {
    for (const match of (header ?? "").matchAll(ADDRESS_IN_HEADER)) {
      found.add(match[0].toLowerCase());
    }
  }
  return [...found];
}

/** "Re: " prefix for a reply, without stacking "Re: Re:". */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed || "(no subject)"}`;
}

/** References header for a reply: the parent's references plus its own id. */
export function replyReferences(parentReferences: string, parentMessageId: string): string {
  return [parentReferences.trim(), parentMessageId.trim()].filter(Boolean).join(" ");
}

/** "Fwd: " prefix, without stacking. */
export function forwardSubject(subject: string): string {
  const trimmed = subject.trim();
  return /^(fwd?|fw):/i.test(trimmed) ? trimmed : `Fwd: ${trimmed || "(no subject)"}`;
}

/** Quoted original for a reply body ("On … wrote:" + "> " lines). */
export function quoteForReply(input: {
  from: string;
  date: string;
  bodyText: string;
}): string {
  const quoted = input.bodyText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${input.date}, ${input.from} wrote:\n${quoted}`;
}

/** Header block Gmail-style for a forwarded message body. */
export function forwardBlock(input: {
  from: string;
  date: string;
  subject: string;
  to: string;
  cc: string;
  bodyText: string;
}): string {
  return [
    "",
    "",
    "---------- Forwarded message ---------",
    `From: ${input.from}`,
    `Date: ${input.date}`,
    `Subject: ${input.subject}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    "",
    input.bodyText,
  ].join("\n");
}
