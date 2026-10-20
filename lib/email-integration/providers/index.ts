import "server-only";

import { gmailMailbox } from "@/lib/email-integration/mailbox/gmail";
import { microsoftMailbox } from "@/lib/email-integration/mailbox/microsoft";
import type { MailboxAdapter } from "@/lib/email-integration/mailbox/provider";
import { googleEmailAdapter } from "@/lib/email-integration/providers/google";
import { microsoftEmailAdapter } from "@/lib/email-integration/providers/microsoft";
import type { EmailSendAdapter } from "@/lib/email-integration/providers/types";
import { yahooEmailAdapter, yahooMailbox } from "@/lib/email-integration/providers/yahoo";
import type { EmailProvider } from "@/lib/email-integration/types";

const SEND_ADAPTERS: Record<EmailProvider, EmailSendAdapter> = {
  google: googleEmailAdapter,
  microsoft: microsoftEmailAdapter,
  yahoo: yahooEmailAdapter,
};

const MAILBOX_ADAPTERS: Record<EmailProvider, MailboxAdapter> = {
  google: gmailMailbox,
  microsoft: microsoftMailbox,
  yahoo: yahooMailbox,
};

export function parseEmailProvider(value: string): EmailProvider | null {
  return Object.hasOwn(SEND_ADAPTERS, value) ? (value as EmailProvider) : null;
}

/** Sign-in and sending for a provider. */
export function getEmailAdapter(provider: string): EmailSendAdapter | null {
  const parsed = parseEmailProvider(provider);
  return parsed ? SEND_ADAPTERS[parsed] : null;
}

/** Reading and organising a provider's mailbox. */
export function getMailboxAdapter(provider: string): MailboxAdapter | null {
  const parsed = parseEmailProvider(provider);
  return parsed ? MAILBOX_ADAPTERS[parsed] : null;
}

/** Providers whose OAuth app credentials are configured on this server. */
export function listConfiguredProviders(): EmailProvider[] {
  return (Object.keys(SEND_ADAPTERS) as EmailProvider[]).filter((provider) =>
    SEND_ADAPTERS[provider].isConfigured(),
  );
}
