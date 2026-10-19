import "server-only";

/**
 * Stage 1 business-mailbox sending (quotes and invoices sent from the
 * business's own Gmail account). Everything is gated by EMAIL_SEND_ENABLED so
 * the routes, worker and UI stay dark until a pilot is switched on.
 */

export const EMAIL_CONNECTIONS_COLLECTION = "email_connections";
/** Encrypted credentials, kept apart from connection metadata. */
export const EMAIL_CREDENTIALS_COLLECTION = "email_connection_credentials";
export const EMAIL_OUTBOX_COLLECTION = "email_outbox";
export const EMAIL_EVENTS_COLLECTION = "email_events";
export const EMAIL_OAUTH_STATES_COLLECTION = "email_oauth_states";
/** Synced Inbox/Sent metadata (bodies are fetched on demand, never stored). */
export const EMAIL_MESSAGES_COLLECTION = "email_messages";
export const EMAIL_SYNC_STATE_COLLECTION = "email_sync_state";

export const EMAIL_MAX_RECIPIENTS = 10;
export const EMAIL_MAX_PDF_BYTES = 2 * 1024 * 1024;
export const EMAIL_MAX_SUBJECT_LENGTH = 200;
export const EMAIL_MAX_BODY_LENGTH = 20_000;
export const EMAIL_MAX_ATTEMPTS = 5;
/** Backoff between automatic retries of safe transient failures. */
export const EMAIL_BACKOFF_SECONDS = [60, 300, 900, 3600] as const;
/** How long a worker owns a claimed item before it is considered crashed. */
export const EMAIL_LEASE_MS = 2 * 60 * 1000;
export const EMAIL_PROVIDER_TIMEOUT_MS = 25_000;
export const EMAIL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const EMAIL_OUTBOX_BATCH_SIZE = 20;
/** Most changed messages one incremental history run will process. */
export const MAILBOX_SYNC_MAX_MESSAGES = 200;
/** Time one sync run may spend before saving progress and stopping. */
export const MAILBOX_SYNC_BUDGET_MS = 40 * 1000;
/** Customer addresses per Gmail search when importing past mail. */
export const MAILBOX_SEARCH_ADDRESSES_PER_QUERY = 8;
export const MAILBOX_SYNC_LEASE_MS = 3 * 60 * 1000;
export const MAILBOX_SYNC_MIN_INTERVAL_MS = 15 * 1000;
export const MAILBOX_THREAD_MAX_MESSAGES = 25;
export const MAILBOX_BODY_MAX_CHARS = 100_000;
/** Files attached from the browser. Kept under Vercel's 4.5 MB request limit. */
export const MAILBOX_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** All attachments on one email, including forwarded originals (Gmail allows 25 MB encoded). */
export const MAILBOX_ATTACHMENTS_MAX_BYTES = 15 * 1024 * 1024;
export const MAILBOX_ATTACHMENTS_MAX_FILES = 10;

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when business-mailbox sending is on for this business. When
 * EMAIL_SEND_PILOT_BUSINESS_IDS is set, only the listed businesses get it.
 */
export function isEmailSendEnabled(businessId?: string | null): boolean {
  if (process.env.EMAIL_SEND_ENABLED?.trim().toLowerCase() !== "true") {
    return false;
  }
  const pilots = (process.env.EMAIL_SEND_PILOT_BUSINESS_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (pilots.length === 0) return true;
  return Boolean(businessId && pilots.includes(businessId));
}

/**
 * Optional non-production safety net: when EMAIL_RECIPIENT_ALLOWLIST is set,
 * every recipient must match an exact address or an `@domain` entry.
 */
export function isRecipientAllowed(address: string): boolean {
  const allowlist = csv(process.env.EMAIL_RECIPIENT_ALLOWLIST);
  if (allowlist.length === 0) return true;
  const normalised = address.trim().toLowerCase();
  const domain = normalised.slice(normalised.lastIndexOf("@"));
  return allowlist.includes(normalised) || allowlist.includes(domain);
}

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_EMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_EMAIL_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_EMAIL_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}
