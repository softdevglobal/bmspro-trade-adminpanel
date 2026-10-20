import "server-only";

import {
  EMAIL_PROVIDER_TIMEOUT_MS,
  getMicrosoftOAuthConfig,
  type MicrosoftOAuthConfig,
} from "@/lib/email-integration/config";
import {
  ProviderOAuthError,
  type ConnectedAccount,
  type EmailSendAdapter,
  type ProviderCredentials,
  type RefreshResult,
  type SendPayload,
  type SendResult,
} from "@/lib/email-integration/providers/types";

export const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * Ids that survive moving a message between folders (archive, delete,
 * restore). Every Graph call uses them, so stored ids stay valid.
 */
export const IMMUTABLE_IDS = { Prefer: 'IdType="ImmutableId"' };

/** Sending only by default; the mailbox is an explicit, separate opt-in. */
const SEND_SCOPES = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Send"];
/** Read and organise mail, and create drafts so replies thread properly. */
const MAILBOX_SCOPE = "Mail.ReadWrite";

/** Graph's request limit is 4 MB; base64 adds a third, so inline files stay under 3 MB. */
const INLINE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
/** Upload sessions take chunks in multiples of 320 KiB. */
const UPLOAD_CHUNK = 320 * 1024 * 12;

function requireConfig(): MicrosoftOAuthConfig {
  const config = getMicrosoftOAuthConfig();
  if (!config) {
    throw new ProviderOAuthError("not_configured", "Microsoft email is not configured.");
  }
  return config;
}

function tokenUrl(config: MicrosoftOAuthConfig): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`;
}

/** Scope names as Microsoft returns them, normalised (prefix removed, lower case). */
export function normaliseGraphScopes(scope: string | undefined): string[] {
  return (scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => item.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase());
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
};

async function postToken(config: MicrosoftOAuthConfig, body: URLSearchParams) {
  const response = await fetch(tokenUrl(config), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  return { status: response.status, data };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function retryAfterSeconds(response: Response): number | null {
  const seconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

class GraphCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly graphCode: string,
    public readonly retryAfter: number | null,
  ) {
    super(`graph_${status}`);
  }
}

/** One Graph call with a JSON body; throws GraphCallError for HTTP errors. */
async function graph<T>(
  credentials: ProviderCredentials,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      ...IMMUTABLE_IDS,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    throw new GraphCallError(response.status, data.error?.code ?? "", retryAfterSeconds(response));
  }
  if (response.status === 202 || response.status === 204) return undefined as T;
  return (await response.json().catch(() => undefined)) as T;
}

/** Turns a Graph error into the outbox's outcome, for steps before the final send. */
function failureFor(error: unknown, stage: "prepare" | "send"): SendResult {
  if (error instanceof GraphCallError) {
    if (error.status === 401 || (error.status === 403 && /AccessDenied|Authorization/i.test(error.graphCode))) {
      return {
        kind: "auth_failure",
        code: `graph_${error.status}`,
        detail: "Microsoft rejected the saved sign-in. Reconnect the mailbox.",
      };
    }
    if (error.status === 429 || error.status === 503 || error.status === 504) {
      return {
        kind: "safe_failure",
        code: `graph_${error.status}`,
        detail: "Microsoft asked us to slow down. The email will be retried.",
        retryable: stage === "prepare" || error.status === 429,
        retryAfterSeconds: error.retryAfter,
      };
    }
    if (error.status >= 500 && stage === "send") {
      return {
        kind: "unknown",
        code: `graph_${error.status}`,
        detail: "Microsoft returned a server error before confirming the send.",
      };
    }
    return {
      kind: "safe_failure",
      code: `graph_${error.status}`,
      detail: "Microsoft rejected the email. Check the recipients and attachments and try again.",
      retryable: error.status >= 500,
      retryAfterSeconds: null,
    };
  }
  if (stage === "send") {
    return {
      kind: "unknown",
      code: isTimeout(error) ? "provider_timeout" : "provider_network_error",
      detail: "Microsoft did not confirm whether the email was sent.",
    };
  }
  return {
    kind: "safe_failure",
    code: isTimeout(error) ? "provider_timeout" : "provider_network_error",
    detail: "Could not reach Microsoft. The email will be retried.",
    retryable: true,
    retryAfterSeconds: null,
  };
}

const recipients = (addresses: string[]) =>
  addresses.map((address) => ({ emailAddress: { address } }));

type Draft = { id: string; conversationId?: string };

/** Creates the draft: a reply through Outlook's reply API, or a new message. */
async function createDraft(credentials: ProviderCredentials, payload: SendPayload): Promise<Draft> {
  const fields = {
    subject: payload.subject,
    body: { contentType: "Text", content: payload.bodyText },
    toRecipients: recipients(payload.to),
    ccRecipients: recipients(payload.cc),
    bccRecipients: recipients(payload.bcc),
  };
  const replyTo = payload.thread?.replyToProviderMessageId;
  if (replyTo) {
    try {
      const draft = await graph<Draft>(
        credentials,
        "POST",
        `/me/messages/${encodeURIComponent(replyTo)}/createReply`,
        {},
      );
      // Our body already contains the quoted original; replace Outlook's.
      await graph(credentials, "PATCH", `/me/messages/${encodeURIComponent(draft.id)}`, fields);
      return draft;
    } catch (error) {
      // The original was deleted: send it as a new message instead.
      if (!(error instanceof GraphCallError && error.status === 404)) throw error;
    }
  }
  return graph<Draft>(credentials, "POST", "/me/messages", {
    ...fields,
    internetMessageHeaders: [{ name: "X-BMS-Outbox-Id", value: payload.outboxId }],
  });
}

async function attachToDraft(
  credentials: ProviderCredentials,
  draftId: string,
  attachment: SendPayload["attachments"][number],
): Promise<void> {
  const base = `/me/messages/${encodeURIComponent(draftId)}/attachments`;
  if (attachment.content.length <= INLINE_ATTACHMENT_LIMIT) {
    await graph(credentials, "POST", base, {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.filename,
      contentType: attachment.contentType,
      contentBytes: attachment.content.toString("base64"),
    });
    return;
  }
  // Large files go up in chunks through an upload session.
  const session = await graph<{ uploadUrl: string }>(credentials, "POST", `${base}/createUploadSession`, {
    AttachmentItem: {
      attachmentType: "file",
      name: attachment.filename,
      size: attachment.content.length,
      contentType: attachment.contentType,
    },
  });
  if (!session.uploadUrl.startsWith("https://")) throw new GraphCallError(502, "bad_upload_url", null);
  const total = attachment.content.length;
  for (let start = 0; start < total; start += UPLOAD_CHUNK) {
    const end = Math.min(start + UPLOAD_CHUNK, total);
    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: new Uint8Array(attachment.content.subarray(start, end)),
      signal: AbortSignal.timeout(EMAIL_PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new GraphCallError(response.status, "upload_failed", retryAfterSeconds(response));
  }
}

/** Send-only connections (no Mail.ReadWrite): one sendMail call, files inline. */
async function sendDirect(credentials: ProviderCredentials, payload: SendPayload): Promise<SendResult> {
  const totalBytes = payload.attachments.reduce((sum, file) => sum + file.content.length, 0);
  if (totalBytes > INLINE_ATTACHMENT_LIMIT) {
    return {
      kind: "safe_failure",
      code: "attachments_too_large",
      detail: "Attachments over 3 MB need the mailbox enabled for this Microsoft account.",
      retryable: false,
      retryAfterSeconds: null,
    };
  }
  try {
    await graph(credentials, "POST", "/me/sendMail", {
      message: {
        subject: payload.subject,
        body: { contentType: "Text", content: payload.bodyText },
        toRecipients: recipients(payload.to),
        ccRecipients: recipients(payload.cc),
        bccRecipients: recipients(payload.bcc),
        internetMessageHeaders: [{ name: "X-BMS-Outbox-Id", value: payload.outboxId }],
        attachments: payload.attachments.map((file) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: file.filename,
          contentType: file.contentType,
          contentBytes: file.content.toString("base64"),
        })),
      },
      saveToSentItems: true,
    });
  } catch (error) {
    return failureFor(error, "send");
  }
  // 202 Accepted: Microsoft returns no id for sendMail.
  return { kind: "accepted", providerMessageId: null, providerThreadId: null };
}

/** Mailbox connections: draft, attachments, then send — so ids and threading are known. */
async function sendViaDraft(credentials: ProviderCredentials, payload: SendPayload): Promise<SendResult> {
  let draft: Draft;
  try {
    draft = await createDraft(credentials, payload);
    for (const attachment of payload.attachments) {
      await attachToDraft(credentials, draft.id, attachment);
    }
  } catch (error) {
    return failureFor(error, "prepare");
  }
  try {
    await graph(credentials, "POST", `/me/messages/${encodeURIComponent(draft.id)}/send`);
  } catch (error) {
    const result = failureFor(error, "send");
    if (result.kind !== "unknown") {
      // Not sent: tidy the draft so a retry doesn't leave duplicates behind.
      await graph(credentials, "DELETE", `/me/messages/${encodeURIComponent(draft.id)}`).catch(
        () => undefined,
      );
    }
    return result;
  }
  return {
    kind: "accepted",
    // With immutable ids the draft keeps its id when it moves to Sent Items.
    providerMessageId: draft.id,
    providerThreadId: draft.conversationId ?? null,
  };
}

export const microsoftEmailAdapter: EmailSendAdapter = {
  provider: "microsoft",
  label: "Outlook",

  isConfigured: () => getMicrosoftOAuthConfig() !== null,

  redirectUri: () => getMicrosoftOAuthConfig()?.redirectUri ?? null,

  buildAuthorizationUrl({ state, codeChallenge, loginHint, includeRead }) {
    const config = requireConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      response_mode: "query",
      scope: (includeRead ? [...SEND_SCOPES, MAILBOX_SCOPE] : SEND_SCOPES).join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    if (loginHint?.trim()) params.set("login_hint", loginHint.trim());
    return `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize?${params}`;
  },

  async exchangeCode({ code, codeVerifier }): Promise<ConnectedAccount> {
    const config = requireConfig();
    const { status, data } = await postToken(
      config,
      new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    );
    if (status !== 200 || !data.access_token) {
      throw new ProviderOAuthError(
        data.error ?? "token_exchange_failed",
        "Microsoft did not complete the connection. Please try again.",
      );
    }
    if (!data.refresh_token) {
      throw new ProviderOAuthError(
        "missing_refresh_token",
        "Microsoft did not grant offline access. Please try connecting again.",
      );
    }
    const scopes = normaliseGraphScopes(data.scope);
    if (!scopes.includes("mail.send")) {
      throw new ProviderOAuthError(
        "missing_scope",
        "Permission to send email was not granted. Accept the send permission when connecting.",
      );
    }
    const credentials: ProviderCredentials = {
      accessToken: data.access_token,
      accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      refreshToken: data.refresh_token,
      scope: data.scope,
    };
    // Identity comes from Graph itself, for work, school and personal accounts alike.
    const me = await graph<{
      id?: string;
      mail?: string | null;
      userPrincipalName?: string | null;
      displayName?: string | null;
    }>(credentials, "GET", "/me?$select=id,mail,userPrincipalName,displayName").catch(() => null);
    const address = (me?.mail || me?.userPrincipalName || "").trim();
    if (!me?.id || !address.includes("@")) {
      throw new ProviderOAuthError("invalid_identity", "Microsoft sign-in failed.");
    }
    return {
      providerAccountId: me.id,
      address,
      displayName: me.displayName?.trim() || null,
      grantedScopes: scopes,
      credentials,
    };
  },

  async refresh(credentials): Promise<RefreshResult> {
    const config = requireConfig();
    try {
      const { status, data } = await postToken(
        config,
        new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: credentials.refreshToken,
          grant_type: "refresh_token",
          scope: credentials.scope || SEND_SCOPES.join(" "),
        }),
      );
      if (status === 200 && data.access_token) {
        return {
          ok: true,
          credentials: {
            accessToken: data.access_token,
            accessTokenExpiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
            // Microsoft rotates refresh tokens; keep the newest one.
            refreshToken: data.refresh_token ?? credentials.refreshToken,
            scope: data.scope ?? credentials.scope,
          },
        };
      }
      const authFailure =
        data.error === "invalid_grant" ||
        data.error === "interaction_required" ||
        data.error === "unauthorized_client";
      return { ok: false, authFailure, code: data.error ?? `http_${status}` };
    } catch (error) {
      return {
        ok: false,
        authFailure: false,
        code: isTimeout(error) ? "refresh_timeout" : "refresh_network_error",
      };
    }
  },

  send(credentials, payload) {
    const canDraft = normaliseGraphScopes(credentials.scope).includes("mail.readwrite");
    return canDraft ? sendViaDraft(credentials, payload) : sendDirect(credentials, payload);
  },

  async revoke() {
    // Microsoft has no per-app token revocation endpoint for delegated access.
    // Disconnecting deletes our credentials; owners can also remove the app at
    // https://account.live.com/consent/Manage or https://myapplications.microsoft.com.
  },
};
