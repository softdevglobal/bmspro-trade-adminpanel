import "server-only";

import { EMAIL_PROVIDER_TIMEOUT_MS } from "@/lib/email-integration/config";
import { threadIdFor, threadRoot } from "@/lib/email-integration/imap/ids";
import type { ImapServerConfig } from "@/lib/email-integration/imap/servers";
import { createImapClient, withImap } from "@/lib/email-integration/imap/session";
import { buildMimeMessage } from "@/lib/email-integration/mime";
import {
  ProviderOAuthError,
  type ConnectedAccount,
  type EmailSendAdapter,
  type SendResult,
} from "@/lib/email-integration/providers/types";
import type { EmailProvider } from "@/lib/email-integration/types";
import nodemailer from "nodemailer";

/** Scopes recorded for an app-password login: it can read, organise and send. */
export const APP_PASSWORD_SCOPES = ["imap", "smtp"];

function createTransport(server: ImapServerConfig, login: { user: string; pass: string }) {
  return nodemailer.createTransport({
    host: server.smtp.host,
    port: server.smtp.port,
    secure: true,
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
export function classifySmtpError(error: unknown, label: string): SendResult {
  const err = (error ?? {}) as { code?: string; responseCode?: number; command?: string };
  const status = typeof err.responseCode === "number" ? err.responseCode : 0;
  const code = err.code ?? "";
  if (code === "EAUTH" || status === 534 || status === 535) {
    return {
      kind: "auth_failure",
      code: "smtp_auth",
      detail: `${label} rejected the saved app password. Reconnect the mailbox.`,
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
      detail: `Could not reach ${label}.`,
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

/**
 * Sign-in and sending for a mailbox reached with an app password: IMAP to
 * check the login (and read mail), SMTP to send.
 */
export function createAppPasswordAdapter(
  provider: EmailProvider,
  server: ImapServerConfig,
): EmailSendAdapter {
  const label = server.label;

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
      const pass = normaliseAppPassword(input.password);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !pass) {
        throw new ProviderOAuthError("invalid_login", "Enter the email address and app password.");
      }
      const login = { user: address, pass };

      const imap = createImapClient(server, login);
      imap.on("error", () => undefined);
      try {
        await imap.connect();
      } catch (error) {
        const failed = (error as { authenticationFailed?: boolean }).authenticationFailed;
        throw new ProviderOAuthError(
          failed ? "invalid_login" : "server_unreachable",
          failed
            ? `${label} didn't accept that email and app password.`
            : `Could not reach ${label}. Please try again.`,
        );
      } finally {
        await imap.logout().catch(() => imap.close());
      }

      const smtp = createTransport(server, login);
      try {
        await smtp.verify();
      } catch (error) {
        const result = classifySmtpError(error, label);
        throw new ProviderOAuthError(
          result.kind === "auth_failure" ? "invalid_login" : "server_unreachable",
          result.kind === "auth_failure"
            ? `${label} didn't accept that app password for sending.`
            : `Could not reach ${label} to send. Please try again.`,
        );
      } finally {
        smtp.close();
      }

      return {
        providerAccountId: address,
        address,
        displayName: null,
        grantedScopes: APP_PASSWORD_SCOPES,
        credentials: {
          // Nothing expires: the app password works until it is revoked.
          accessToken: "",
          accessTokenExpiresAt: Number.MAX_SAFE_INTEGER,
          refreshToken: "",
          password: login,
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
      if (!login) {
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

      const transport = createTransport(server, login);
      try {
        const info = await transport.sendMail({
          envelope: { from: payload.from, to: [...payload.to, ...payload.cc, ...payload.bcc] },
          raw,
        });
        if (info.accepted.length === 0) {
          return {
            kind: "safe_failure",
            code: "recipients_rejected",
            detail: `${label} did not accept any of the recipients.`,
            retryable: false,
            retryAfterSeconds: null,
          };
        }
      } catch (error) {
        return classifySmtpError(error, label);
      } finally {
        transport.close();
      }

      if (!server.savesSentCopy) {
        // Best effort: the email has gone, a missing Sent copy is not a failure.
        await withImap(server, credentials, async (context) => {
          const sent = (await context.folders()).get("sent");
          if (sent) await context.client.append(sent, raw, ["\\Seen"]);
        }).catch(() => console.warn("[email/send] could not file the Sent copy"));
      }

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

    // An app password can only be removed by the owner at the provider.
    async revoke() {},
  };
}
