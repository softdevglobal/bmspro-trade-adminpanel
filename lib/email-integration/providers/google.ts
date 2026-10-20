import "server-only";

import {
  EMAIL_PROVIDER_TIMEOUT_MS,
  getGoogleOAuthConfig,
  type GoogleOAuthConfig,
} from "@/lib/email-integration/config";
import { buildMimeMessage } from "@/lib/email-integration/mime";
import {
  ProviderOAuthError,
  type ConnectedAccount,
  type EmailSendAdapter,
  type ProviderCredentials,
  type RefreshResult,
  type SendResult,
} from "@/lib/email-integration/providers/types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/**
 * Mailbox access: read plus label changes (read/unread, star, archive, trash).
 * It cannot permanently delete mail. Older connections may hold gmail.readonly.
 */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/** Sending only by default; reading the mailbox is an explicit, separate opt-in. */
const SEND_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export class GoogleOAuthError extends ProviderOAuthError {}

function requireConfig(): GoogleOAuthConfig {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new GoogleOAuthError(
      "not_configured",
      "Google email sending is not configured.",
    );
  }
  return config;
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: URLSearchParams): Promise<{
  status: number;
  data: TokenResponse;
}> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  return { status: response.status, data };
}

/**
 * Reads identity claims from the ID token. The token comes straight from
 * Google's token endpoint over TLS, so per OpenID Connect Core §3.1.3.7 the
 * signature check may be skipped; issuer, audience and expiry are still
 * validated.
 */
function readIdToken(idToken: string, clientId: string) {
  const [, payloadPart] = idToken.split(".");
  if (!payloadPart) {
    throw new GoogleOAuthError("invalid_identity", "Google sign-in failed.");
  }
  const claims = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  const exp = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
  if (
    !ISSUERS.has(String(claims.iss)) ||
    !audiences.includes(clientId) ||
    exp < Date.now() ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string"
  ) {
    throw new GoogleOAuthError("invalid_identity", "Google sign-in failed.");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new GoogleOAuthError(
      "unverified_email",
      "This Google account's email address is not verified.",
    );
  }
  return {
    sub: claims.sub,
    email: claims.email.trim(),
    name: typeof claims.name === "string" ? claims.name.trim() : null,
  };
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date)
    ? Math.max(0, Math.round((date - Date.now()) / 1000))
    : null;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

/** Connection never reached Google, so nothing could have been sent. */
function isPreConnectFailure(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  return (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
  );
}

export const googleEmailAdapter: EmailSendAdapter = {
  provider: "google",
  label: "Gmail",

  isConfigured: () => getGoogleOAuthConfig() !== null,

  redirectUri: () => getGoogleOAuthConfig()?.redirectUri ?? null,

  buildAuthorizationUrl({ state, codeChallenge, loginHint, includeRead }) {
    const config = requireConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: (includeRead ? [...SEND_SCOPES, GMAIL_MODIFY_SCOPE] : SEND_SCOPES).join(" "),
      // Keep anything already granted (e.g. read) when reconnecting for send.
      include_granted_scopes: "true",
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (loginHint?.trim()) params.set("login_hint", loginHint.trim());
    return `${AUTH_URL}?${params}`;
  },

  async exchangeCode({ code, codeVerifier }): Promise<ConnectedAccount> {
    const config = requireConfig();
    const { status, data } = await postToken(
      new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    );
    if (status !== 200 || !data.access_token || !data.id_token) {
      throw new GoogleOAuthError(
        data.error ?? "token_exchange_failed",
        "Google did not complete the connection. Please try again.",
      );
    }
    if (!data.refresh_token) {
      throw new GoogleOAuthError(
        "missing_refresh_token",
        "Google did not grant offline access. Please try connecting again.",
      );
    }
    const grantedScopes = (data.scope ?? "").split(/\s+/).filter(Boolean);
    if (!grantedScopes.includes(GMAIL_SEND_SCOPE)) {
      throw new GoogleOAuthError(
        "missing_scope",
        "Permission to send email was not granted. Tick the Gmail send permission when connecting.",
      );
    }
    const identity = readIdToken(data.id_token, config.clientId);
    return {
      providerAccountId: identity.sub,
      address: identity.email,
      displayName: identity.name,
      grantedScopes,
      credentials: {
        accessToken: data.access_token,
        accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        refreshToken: data.refresh_token,
      },
    };
  },

  async refresh(credentials): Promise<RefreshResult> {
    const config = requireConfig();
    try {
      const { status, data } = await postToken(
        new URLSearchParams({
          refresh_token: credentials.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
        }),
      );
      if (status === 200 && data.access_token) {
        return {
          ok: true,
          credentials: {
            accessToken: data.access_token,
            accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
            // Google usually omits the refresh token on refresh — keep ours.
            refreshToken: data.refresh_token ?? credentials.refreshToken,
          },
        };
      }
      const authFailure =
        data.error === "invalid_grant" || data.error === "unauthorized_client";
      return { ok: false, authFailure, code: data.error ?? `http_${status}` };
    } catch (error) {
      return {
        ok: false,
        authFailure: false,
        code: isTimeout(error) ? "refresh_timeout" : "refresh_network_error",
      };
    }
  },

  async send(credentials: ProviderCredentials, payload): Promise<SendResult> {
    let raw: string;
    try {
      raw = Buffer.from(
        buildMimeMessage({
          from: payload.from,
          fromName: payload.fromName,
          to: payload.to,
          cc: payload.cc,
          bcc: payload.bcc,
          subject: payload.subject,
          bodyText: payload.bodyText,
          messageId: payload.messageId,
          headers: {
            "X-BMS-Outbox-Id": payload.outboxId,
            ...(payload.thread?.inReplyTo
              ? {
                  "In-Reply-To": payload.thread.inReplyTo,
                  References: payload.thread.references || payload.thread.inReplyTo,
                }
              : {}),
          },
          attachments: payload.attachments,
        }),
        "utf8",
      ).toString("base64url");
    } catch (error) {
      return {
        kind: "safe_failure",
        code: "invalid_message",
        detail: error instanceof Error ? error.message : "Invalid message.",
        retryable: false,
        retryAfterSeconds: null,
      };
    }

    let response: Response;
    try {
      response = await fetch(SEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          payload.thread ? { raw, threadId: payload.thread.providerThreadId } : { raw },
        ),
        signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      if (isPreConnectFailure(error)) {
        return {
          kind: "safe_failure",
          code: "network_unreachable",
          detail: "Could not reach Gmail.",
          retryable: true,
          retryAfterSeconds: null,
        };
      }
      return {
        kind: "unknown",
        code: isTimeout(error) ? "provider_timeout" : "provider_network_error",
        detail: "Gmail did not confirm whether the email was sent.",
      };
    }

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      threadId?: string;
      error?: {
        status?: string;
        message?: string;
        errors?: { reason?: string }[];
      };
    };

    if (response.ok) {
      return {
        kind: "accepted",
        providerMessageId: data.id ?? null,
        providerThreadId: data.threadId ?? null,
      };
    }

    const status = response.status;
    const reason = data.error?.errors?.[0]?.reason ?? "";
    // Gmail reports per-user rate limits as 403 as well as 429.
    const rateLimited =
      status === 429 || status === 503 || /RateLimitExceeded|dailyLimitExceeded/i.test(reason);
    if (
      !rateLimited &&
      (status === 401 ||
        (status === 403 &&
          (reason === "insufficientPermissions" ||
            data.error?.status === "PERMISSION_DENIED")))
    ) {
      return {
        kind: "auth_failure",
        code: `gmail_${status}`,
        detail: "Gmail rejected the saved sign-in. Reconnect the mailbox.",
      };
    }
    if (rateLimited) {
      return {
        kind: "safe_failure",
        code: `gmail_${status}`,
        detail: "Gmail asked us to slow down. The email will be retried.",
        retryable: true,
        retryAfterSeconds: retryAfterSeconds(response),
      };
    }
    if (status >= 500) {
      // A 5xx may arrive after Gmail already accepted the message.
      return {
        kind: "unknown",
        code: `gmail_${status}`,
        detail: "Gmail returned a server error before confirming the send.",
      };
    }
    return {
      kind: "safe_failure",
      code: `gmail_${status}`,
      detail: "Gmail rejected the email. Check the recipients and try again.",
      retryable: false,
      retryAfterSeconds: null,
    };
  },

  async revoke(credentials) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: credentials.refreshToken }),
        signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      console.error("[email/google] revoke failed", (error as Error)?.name);
    }
  },
};
