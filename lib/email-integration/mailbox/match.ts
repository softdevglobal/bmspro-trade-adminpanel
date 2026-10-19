import { extractAddresses } from "@/lib/email-integration/mailbox/parse";
import type { MailboxMatch, PlatformDocumentRef } from "@/lib/email-integration/types";

/**
 * Labels how a message relates to the platform, in this order:
 *   1. it is in a thread the platform sent (quote, invoice, compose, reply);
 *   2. an outside participant is a known customer of this business;
 *   3. it continues a conversation already linked to a customer;
 *   4. otherwise "none" (still shown, just not linked).
 * Never guesses: a customer name is only set when the matched addresses have
 * exactly one.
 */
export function classifyMessage(input: {
  threadId: string;
  from: string;
  to: string;
  cc: string;
  ownAddress: string;
  customers: Map<string, Set<string>>;
  platformThreads: Map<string, PlatformDocumentRef>;
  /** Threads already linked to a customer or the platform. */
  linkedThreads: Set<string>;
}): MailboxMatch {
  const own = input.ownAddress.trim().toLowerCase();
  const external = extractAddresses(input.from, input.to, input.cc).filter(
    (address) => address !== own,
  );
  const customerEmails = external.filter((address) => input.customers.has(address));
  const names = new Set<string>();
  for (const email of customerEmails) {
    for (const name of input.customers.get(email) ?? []) names.add(name);
  }
  const customerName = names.size === 1 ? [...names][0] : null;

  const method = input.platformThreads.has(input.threadId)
    ? "platform_thread"
    : customerEmails.length > 0
      ? "customer"
      : input.linkedThreads.has(input.threadId)
        ? "thread"
        : "none";
  return {
    method,
    customerEmails,
    customerName,
    document: input.platformThreads.get(input.threadId) ?? null,
  };
}
