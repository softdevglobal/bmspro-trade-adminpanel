import "server-only";

import { createImapMailbox } from "@/lib/email-integration/mailbox/imap";
import { createAppPasswordAdapter } from "@/lib/email-integration/providers/app-password";

/**
 * "Other email provider": an existing mailbox on the owner's own host (Zoho,
 * cPanel / web hosting, …). The owner enters the IMAP and SMTP servers; they
 * are stored with the encrypted password and used for every connection.
 */
export const otherEmailAdapter = createAppPasswordAdapter("imap", null, { label: "your mail server" });
export const otherMailbox = createImapMailbox(null);
