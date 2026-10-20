import "server-only";

import { YAHOO_SERVERS } from "@/lib/email-integration/imap/servers";
import { createImapMailbox } from "@/lib/email-integration/mailbox/imap";
import { createAppPasswordAdapter } from "@/lib/email-integration/providers/app-password";

/**
 * Yahoo Mail over IMAP/SMTP. Yahoo only grants mail OAuth to approved apps,
 * so owners connect with an app password created in their Yahoo account.
 */
export const yahooEmailAdapter = createAppPasswordAdapter("yahoo", YAHOO_SERVERS);
export const yahooMailbox = createImapMailbox(YAHOO_SERVERS);
