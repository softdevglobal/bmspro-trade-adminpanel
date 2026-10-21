import type { MailServerSettings } from "@/lib/email-integration/imap/servers";
import type { EmailProvider } from "@/lib/email-integration/types";

/** Decrypted credentials. Only ever held in server memory. */
export type ProviderCredentials = {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  accessTokenExpiresAt: number;
  refreshToken: string;
  /** Space-separated scopes granted (needed to refresh some providers' tokens). */
  scope?: string;
  /**
   * Mailboxes reached over IMAP/SMTP with a password (Yahoo, other providers)
   * carry the login here instead of tokens; the token fields are then unused.
   * `server` is set for the owner's own servers ("Other email provider").
   */
  password?: { user: string; pass: string; server?: MailServerSettings };
};

/** A sign-in that couldn't complete; `code` is shown via the settings page. */
export class ProviderOAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ConnectedAccount = {
  providerAccountId: string;
  address: string;
  displayName: string | null;
  grantedScopes: string[];
  credentials: ProviderCredentials;
};

export type SendPayload = {
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  messageId: string;
  outboxId: string;
  attachments: { filename: string; contentType: string; content: Buffer }[];
  /** Replies: keep the conversation threaded at the provider and in clients. */
  thread: SendThread | null;
};

export type SendThread = {
  providerThreadId: string;
  inReplyTo: string;
  references: string;
  /** The message being replied to (Outlook replies through its own reply API). */
  replyToProviderMessageId?: string | null;
};

export type SendResult =
  | {
      kind: "accepted";
      providerMessageId: string | null;
      providerThreadId: string | null;
    }
  /** Rejected before acceptance; `retryable` only when resending is safe. */
  | {
      kind: "safe_failure";
      code: string;
      detail: string;
      retryable: boolean;
      retryAfterSeconds: number | null;
    }
  /** Credentials expired or revoked — the owner must reconnect. */
  | { kind: "auth_failure"; code: string; detail: string }
  /** Outcome cannot be known (timeout mid-request). Never auto-retried. */
  | { kind: "unknown"; code: string; detail: string };

export type RefreshResult =
  | { ok: true; credentials: ProviderCredentials }
  | { ok: false; authFailure: boolean; code: string };

/** Transport only — queueing, permissions and state live in the outbox. */
export interface EmailSendAdapter {
  provider: EmailProvider;
  /** Name shown to owners, e.g. "Gmail". */
  label: string;
  /**
   * "oauth": the owner signs in at the provider. "app_password": the owner
   * enters an app password made at the provider, sent to connectWithPassword.
   */
  authMethod: "oauth" | "app_password";
  /** OAuth app credentials are set on the server. */
  isConfigured(): boolean;
  /** App-password providers: checks the login and returns the account. */
  connectWithPassword?(input: {
    address: string;
    password: string;
    /** Login name when it isn't the address. */
    username?: string;
    /** The owner's own servers ("Other email provider"); raw form input. */
    server?: unknown;
  }): Promise<ConnectedAccount>;
  /** The registered OAuth redirect URI (used to return to the right origin). */
  redirectUri(): string | null;
  buildAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    loginHint?: string | null;
    /** Also ask to read the mailbox (Stage 2 inbox). */
    includeRead?: boolean;
  }): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<ConnectedAccount>;
  refresh(credentials: ProviderCredentials): Promise<RefreshResult>;
  send(credentials: ProviderCredentials, payload: SendPayload): Promise<SendResult>;
  /** Best-effort grant revocation at the provider. */
  revoke(credentials: ProviderCredentials): Promise<void>;
}
