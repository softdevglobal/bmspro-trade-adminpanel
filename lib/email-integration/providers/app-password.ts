import "server-only";

import { EMAIL_PROVIDER_TIMEOUT_MS } from "@/lib/email-integration/config";
import { threadIdFor, threadRoot } from "@/lib/email-integration/imap/ids";
import { resolvePublicMailHost, UnsafeMailHostError } from "@/lib/email-integration/imap/host";
import {
  customServerConfig,
  MailServerSettingsError,
  parseMailServerSettings,
  type ImapServerConfig,
  type MailServerSettings,
} from "@/lib/email-integration/imap/servers";
import { createImapClient, serverFor, withImap } from "@/lib/email-integration/imap/session";
import { buildMimeMessage } from "@/lib/email-integration/mime";
import {
  ProviderOAuthError,
  type ConnectedAccount,
  type EmailSendAdapter,
  type SendResult,
} from "@/lib/email-integration/providers/types";
import type { EmailProvider } from "@/lib/email-integration/types";
import { isIP } from "node:net";
import nodemailer from "nodemailer";

/** Scopes recorded for an app-password login: it can read, organise and send. */
export const APP_PASSWORD_SCOPES = ["imap", "smtp"];

/** SMTP to the server's checked public address; TLS always (implicit or STARTTLS). */
async function createTransport(server: ImapServerConfig, login: { user: string; pass: string }) {
  const address = await resolvePublicMailHost(server.smtp.host);
  return nodemailer.createTransport({
    host: address,
    port: server.smtp.port,
    secure: server.smtp.secure,
    requireTLS: !server.smtp.secure,
    // The certificate is checked against the name the owner entered.
    tls: isIP(server.smtp.host) ? undefined : { servername: server.smtp.host },
    auth: { user: login.user, pass: login.pass },
    connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MS,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** SMTP steps before the message itself; a failure there means nothing was sent. */
const BEFORE_DATA = /^(CONN|EHLO|HELO|STARTTLS|AUTH|MAIL|RCPT)/i;

/**
 * Turns an SMTP failure into a send outcome. A server reply is always
 * definite; a dropped connection is only safe to retry before DATA.
 */
export function classifySmtpError(error: unknown, name: string): SendResult {
  // Messages start with the provider's name ("Yahoo", "Your mail server").
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const err = (error ?? {}) as { code?: string; responseCode?: number; command?: string };
  const status = typeof err.responseCode === "number" ? err.responseCode : 0;
  const code = err.code ?? "";
  if (code === "EAUTH" || status === 534 || status === 535) {
    return {
      kind: "auth_failure",
      code: "smtp_auth",
      detail: `${label} rejected the saved password. Reconnect the mailbox.`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      kind: "safe_failure",
      code: `smtp_${status}`,
      detail: `${label} asked us to try again later. The email will be retried.`,
      retryable: true,
      retryAfterSeconds: status === 421 ? 300 : null,
    };
  }
  if (status >= 500) {
    return {
      kind: "safe_failure",
      code: `smtp_${status}`,
      detail: `${label} refused the email (${status}). Check the recipients and try again.`,
      retryable: false,
      retryAfterSeconds: null,
    };
  }
  if (code === "EENVELOPE") {
    return {
      kind: "safe_failure",
      code: "smtp_envelope",
      detail: `${label} did not accept the recipients.`,
      retryable: false,
      retryAfterSeconds: null,
    };
  }
  if (code === "EDNS" || (err.command && BEFORE_DATA.test(err.command))) {
    return {
      kind: "safe_failure",
      code: "network_unreachable",
      detail: `Could not reach ${name}.`,
      retryable: true,
      retryAfterSeconds: null,
    };
  }
  return {
    kind: "unknown",
    code: code === "ETIMEDOUT" ? "provider_timeout" : "provider_network_error",
    detail: `${label} did not confirm whether the email was sent.`,
  };
}

/** App passwords are shown in groups ("abcd efgh …"); the spaces aren't part of it. */
export function normaliseAppPassword(value: string): string {
  return value.replace(/\s+/g, "");
}

/** Files a sent message in Sent unless the server already did. */
async function fileSentCopy(
  fixed: ImapServerConfig | null,
  server: ImapServerConfig,
  credentials: Parameters<EmailSendAdapter["send"]>[0],
  raw: string,
  messageId: string,
): Promise<void> {
  if (server.savesSentCopy === true) return;
  await withImap(fixed, credentials, async (context) => {
    const sent = (await context.folders()).get("sent");
    if (!sent) return;
    if (server.savesSentCopy === "detect") {
      // Many hosts (Zoho, Gmail-like) save a copy themselves; give it a moment.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const found = await context.inFolder(
        sent,
        () => context.client.search({ header: { "message-id": messageId } }, { uid: true }),
        { fresh: true },
      );
      if (Array.isArray(found) && found.length > 0) return;
    }
    await context.client.append(sent, raw, ["\\Seen"]);
  });
}

/**
 * Sign-in and sending for a mailbox reached with a password: IMAP to check
 * the login (and read mail), SMTP to send. `fixedServer` is the provider's
 * servers (Yahoo); null means each mailbox brings its own ("Other email").
 */
export function createAppPasswordAdapter(
  provider: EmailProvider,
  fixedServer: ImapServerConfig | null,
  options: { label: string },
): EmailSendAdapter {
  const label = options.label;

  return {
    provider,
    label,
    authMethod: "app_password",
    isConfigured: () => true,
    redirectUri: () => null,

    buildAuthorizationUrl() {
      throw new ProviderOAuthError("unsupported", `${label} connects with an app password.`);
    },
    async exchangeCode() {
      throw new ProviderOAuthError("unsupported", `${label} connects with an app password.`);
    },

    async connectWithPassword(input): Promise<ConnectedAccount> {
      const address = input.address.trim().toLowerCase();
      // App passwords are shown in groups; a normal password keeps its spaces.
      const pass = fixedServer ? normaliseAppPassword(input.password) : input.password;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !pass.trim()) {
        throw new ProviderOAuthError("invalid_login", "Enter the email address and password.");
      }
      const user = input.username?.trim() || address;

      let settings: MailServerSettings | undefined;
      if (!fixedServer) {
        try {
          settings = parseMailServerSettings(input.server);
        } catch (error) {
          throw new ProviderOAuthError(
            "invalid_server",
            error instanceof MailServerSettingsError ? error.message : "Check the server settings.",
          );
        }
      }
      const server = settings ? customServerConfig(settings) : fixedServer!;
      const login = { user, pass };
      const where = fixedServer ? label : server.imap.host;

      let imap: Awaited<ReturnType<typeof createImapClient>>;
      try {
        imap = await createImapClient(server, login);
      } catch (error) {
        throw new ProviderOAuthError(
          "invalid_server",
          error instanceof UnsafeMailHostError ? error.message : `Could not reach ${where}.`,
        );
      }
      imap.on("error", () => undefined);
      try {
        await imap.connect();
      } catch (error) {
        const err = error as { authenticationFailed?: boolean; tlsFailed?: boolean };
        throw new ProviderOAuthError(
          err.authenticationFailed ? "invalid_login" : "server_unreachable",
          err.authenticationFailed
            ? `${where} didn't accept that email and password.`
            : err.tlsFailed
              ? `${where} doesn't offer a secure (TLS) connection on that port.`
              : `Could not connect to ${where} (IMAP). Check the server name and port.`,
        );
      } finally {
        await imap.logout().catch(() => imap.close());
      }

      const smtpWhere = fixedServer ? label : server.smtp.host;
      let smtp: Awaited<ReturnType<typeof createTransport>>;
      try {
        smtp = await createTransport(server, login);
      } catch (error) {
        throw new ProviderOAuthError(
          "invalid_server",
          error instanceof UnsafeMailHostError ? error.message : `Could not reach ${smtpWhere}.`,
        );
      }
      try {
        await smtp.verify();
      } catch (error) {
        const result = classifySmtpError(error, label);
        throw new ProviderOAuthError(
          result.kind === "auth_failure" ? "invalid_login" : "server_unreachable",
          result.kind === "auth_failure"
            ? `${smtpWhere} didn't accept that password for sending.`
            : `Could not connect to ${smtpWhere} (SMTP). Check the server name and port.`,
        );
      } finally {
        smtp.close();
      }

      return {
        // The same address on another server is a different mailbox.
        providerAccountId: settings ? `${address}|${settings.imap.host}` : address,
        address,
        displayName: null,
        grantedScopes: APP_PASSWORD_SCOPES,
        credentials: {
          // Nothing expires: the password works until it is changed or revoked.
          accessToken: "",
          accessTokenExpiresAt: Number.MAX_SAFE_INTEGER,
          refreshToken: "",
          password: settings ? { ...login, server: settings } : login,
        },
      };
    },

    async refresh(credentials) {
      return credentials.password
        ? { ok: true, credentials }
        : { ok: false, authFailure: true, code: "credentials_missing" };
    },

    async send(credentials, payload): Promise<SendResult> {
      const login = credentials.password;
      const server = serverFor(fixedServer, credentials);
      if (!login || !server) {
        return { kind: "auth_failure", code: "credentials_missing", detail: "Reconnect the mailbox." };
      }

      let raw: string;
      try {
        // Bcc goes in the SMTP envelope only, never in the delivered headers.
        raw = buildMimeMessage({
          from: payload.from,
          fromName: payload.fromName,
          to: payload.to,
          cc: payload.cc,
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
        });
      } catch (error) {
        return {
          kind: "safe_failure",
          code: "invalid_message",
          detail: error instanceof Error ? error.message : "Invalid message.",
          retryable: false,
          retryAfterSeconds: null,
        };
      }

      let transport: Awaited<ReturnType<typeof createTransport>>;
      try {
        transport = await createTransport(server, login);
      } catch {
        // Nothing was sent: the name didn't resolve to a usable server.
        return {
          kind: "safe_failure",
          code: "network_unreachable",
          detail: `Could not reach ${server.smtp.host}.`,
          retryable: true,
          retryAfterSeconds: null,
        };
      }
      try {
        const info = await transport.sendMail({
          envelope: { from: payload.from, to: [...payload.to, ...payload.cc, ...payload.bcc] },
          raw,
        });
        if (info.accepted.length === 0) {
          return {
            kind: "safe_failure",
            code: "recipients_rejected",
            detail: `${label.charAt(0).toUpperCase()}${label.slice(1)} did not accept any of the recipients.`,
            retryable: false,
            retryAfterSeconds: null,
          };
        }
      } catch (error) {
        return classifySmtpError(error, label);
      } finally {
        transport.close();
      }

      // Best effort: the email has gone, a missing Sent copy is not a failure.
      await fileSentCopy(fixedServer, server, credentials, raw, payload.messageId).catch(() =>
        console.warn("[email/send] could not file the Sent copy"),
      );

      return {
        kind: "accepted",
        providerMessageId: null,
        providerThreadId:
          payload.thread?.providerThreadId ??
          threadIdFor(
            threadRoot({
              messageId: payload.messageId,
              inReplyTo: payload.thread?.inReplyTo ?? "",
              references: payload.thread?.references ?? "",
            }),
            payload.messageId,
          ),
      };
    },

    // A password can only be changed or revoked by the owner at the provider.
    async revoke() {},
  };
}
