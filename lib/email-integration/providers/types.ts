import type { EmailProvider } from "@/lib/email-integration/types";

/** Decrypted credentials. Only ever held in server memory. */
export type ProviderCredentials = {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  accessTokenExpiresAt: number;
  refreshToken: string;
};

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
  thread: { providerThreadId: string; inReplyTo: string; references: string } | null;
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
