import "server-only";

import { EMAIL_PROVIDER_TIMEOUT_MS } from "@/lib/email-integration/config";
import type { ImapServerConfig } from "@/lib/email-integration/imap/servers";
import { MailboxReadError } from "@/lib/email-integration/mailbox/provider";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";
import type { MailboxFolder } from "@/lib/email-integration/types";
import { ImapFlow, type MailboxObject } from "imapflow";
import { createHash } from "node:crypto";

/**
 * Shared IMAP connections. A sync or a page view makes many small reads;
 * each mailbox gets one logged-in connection that is reused while calls are
 * running and closed shortly after the last one. IMAP servers limit how many
 * connections an account may hold, so this also keeps us well under that.
 */

const IDLE_CLOSE_MS = 10_000;

type Session = {
  client: Promise<ImapFlow>;
  users: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  folders: Promise<Map<MailboxFolder, string>> | null;
};

const sessions = new Map<string, Session>();

export type ImapContext = {
  client: ImapFlow;
  /** Server path of each synced folder that exists ("INBOX", "Sent", …). */
  folders(): Promise<Map<MailboxFolder, string>>;
  /**
   * Runs `fn` with `path` selected; calls on one connection take turns.
   * `fresh` re-selects the folder so its counts (UIDNEXT, EXISTS) are current
   * on a reused connection — needed to notice new mail.
   */
  inFolder<T>(
    path: string,
    fn: (mailbox: MailboxObject) => Promise<T>,
    options?: { fresh?: boolean },
  ): Promise<T>;
};

function sessionKey(server: ImapServerConfig, login: { user: string; pass: string }): string {
  const secret = createHash("sha256").update(login.pass).digest("hex").slice(0, 16);
  return `${server.imap.host}|${login.user.toLowerCase()}|${secret}`;
}

export function createImapClient(
  server: ImapServerConfig,
  login: { user: string; pass: string },
): ImapFlow {
  return new ImapFlow({
    host: server.imap.host,
    port: server.imap.port,
    secure: true,
    auth: { user: login.user, pass: login.pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: EMAIL_PROVIDER_TIMEOUT_MS,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    clientInfo: { name: "BMS Pro Trade" },
  });
}

/** Maps an IMAP or socket failure onto the codes the sync understands. */
export function toMailboxError(error: unknown): MailboxReadError {
  if (error instanceof MailboxReadError) return error;
  const err = (error ?? {}) as {
    authenticationFailed?: boolean;
    code?: string;
    responseText?: string;
    serverResponseCode?: string;
    message?: string;
  };
  if (err.authenticationFailed || err.serverResponseCode === "AUTHENTICATIONFAILED") {
    return new MailboxReadError(401, "unauthorised");
  }
  const text = `${err.serverResponseCode ?? ""} ${err.responseText ?? ""} ${err.message ?? ""}`;
  if (/\b(LIMIT|UNAVAILABLE|THROTTLED)\b|too many|rate limit|try again later/i.test(text)) {
    return new MailboxReadError(429, "rate_limited", 60_000);
  }
  if (/^(ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|NoConnection|ConnectionClosed)/.test(err.code ?? "")) {
    return new MailboxReadError(503, "provider_unavailable");
  }
  return new MailboxReadError(502, "imap_error");
}

async function listFolders(client: ImapFlow): Promise<Map<MailboxFolder, string>> {
  const found = new Map<MailboxFolder, string>([["inbox", "INBOX"]]);
  const roles: Record<string, MailboxFolder> = {
    "\\Sent": "sent",
    "\\Archive": "archive",
    "\\Trash": "trash",
  };
  for (const item of await client.list()) {
    const role = item.specialUse ? roles[item.specialUse] : undefined;
    // Prefer the server's own flag over a guess from the folder name.
    if (role && (!found.has(role) || item.specialUseSource === "extension")) {
      found.set(role, item.path);
    }
  }
  return found;
}

function connect(server: ImapServerConfig, login: { user: string; pass: string }, key: string): Promise<ImapFlow> {
  const client = createImapClient(server, login);
  // An unhandled "error" event would crash the process.
  client.on("error", () => sessions.delete(key));
  client.on("close", () => sessions.delete(key));
  return client.connect().then(() => client);
}

/**
 * Runs `fn` on the mailbox's shared connection. Failures come out as
 * MailboxReadError (unauthorised, rate_limited, provider_unavailable, …).
 */
export async function withImap<T>(
  server: ImapServerConfig,
  credentials: ProviderCredentials,
  fn: (context: ImapContext) => Promise<T>,
): Promise<T> {
  const login = credentials.password;
  if (!login) throw new MailboxReadError(401, "unauthorised");
  const key = sessionKey(server, login);

  let session = sessions.get(key);
  if (!session) {
    session = { client: connect(server, login, key), users: 0, idleTimer: null, folders: null };
    sessions.set(key, session);
    session.client.catch(() => sessions.delete(key));
  }
  const current = session;
  current.users += 1;
  if (current.idleTimer) {
    clearTimeout(current.idleTimer);
    current.idleTimer = null;
  }

  try {
    const client = await current.client;
    if (!client.usable) {
      sessions.delete(key);
      throw new MailboxReadError(503, "provider_unavailable");
    }
    return await fn({
      client,
      folders() {
        current.folders ??= listFolders(client);
        return current.folders;
      },
      async inFolder(path, run, options) {
        const lock = await client.getMailboxLock(path);
        try {
          const mailbox = options?.fresh ? await client.mailboxOpen(path) : (client.mailbox as MailboxObject);
          return await run(mailbox);
        } finally {
          lock.release();
        }
      },
    });
  } catch (error) {
    throw toMailboxError(error);
  } finally {
    current.users -= 1;
    if (current.users === 0) {
      current.idleTimer = setTimeout(() => {
        if (sessions.get(key) === current) sessions.delete(key);
        void current.client
          .then((client) => client.logout().catch(() => client.close()))
          .catch(() => undefined);
      }, IDLE_CLOSE_MS);
      current.idleTimer.unref?.();
    }
  }
}
