/**
 * Mail servers for mailboxes reached over IMAP/SMTP with a password: fixed
 * ones (Yahoo) and the owner's own ("Other email provider": Zoho, cPanel
 * hosting, …), whose settings are stored with the encrypted credentials.
 */

export type MailServerEndpoint = {
  host: string;
  port: number;
  /** True: TLS from the start (993 / 465). False: STARTTLS, which is required. */
  secure: boolean;
};

/** The parts of a server setup that are stored per mailbox. */
export type MailServerSettings = {
  imap: MailServerEndpoint;
  smtp: MailServerEndpoint;
};

export type ImapServerConfig = MailServerSettings & {
  /** Name used in messages, e.g. "Yahoo". */
  label: string;
  /**
   * Whether the provider files mail sent over SMTP in Sent by itself.
   * "detect": look for the message in Sent after sending and add it if missing.
   */
  savesSentCopy: boolean | "detect";
  /** Where owners create an app password, if the provider needs one. */
  appPasswordHelpUrl: string | null;
};

export const YAHOO_SERVERS: ImapServerConfig = {
  label: "Yahoo",
  imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
  smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  savesSentCopy: true,
  appPasswordHelpUrl: "https://help.yahoo.com/kb/SLN15241.html",
};

/** Ports the owner's own servers may use. */
export const IMAP_PORTS = [993, 143] as const;
export const SMTP_PORTS = [465, 587, 2525] as const;

/** A server the owner entered, as used for one mailbox. */
export function customServerConfig(settings: MailServerSettings): ImapServerConfig {
  return {
    label: "your mail server",
    imap: settings.imap,
    smtp: settings.smtp,
    savesSentCopy: "detect",
    appPasswordHelpUrl: null,
  };
}

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class MailServerSettingsError extends Error {}

/**
 * Validates server settings typed by an owner. Hostnames only (no IP
 * addresses or "localhost"), on the usual mail ports; plain-text connections
 * are never allowed (port 143 / 587 / 2525 use STARTTLS).
 */
export function parseMailServerSettings(raw: unknown): MailServerSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const endpoint = (kind: "imap" | "smtp"): MailServerEndpoint => {
    const host = typeof input[`${kind}_host`] === "string"
      ? (input[`${kind}_host`] as string).trim().toLowerCase().replace(/\.$/, "")
      : "";
    const port = Number(input[`${kind}_port`]);
    const name = kind.toUpperCase();
    if (!HOSTNAME.test(host)) {
      throw new MailServerSettingsError(`Enter the ${name} server name, e.g. ${kind}.example.com.`);
    }
    const allowed: readonly number[] = kind === "imap" ? IMAP_PORTS : SMTP_PORTS;
    if (!allowed.includes(port)) {
      throw new MailServerSettingsError(`${name} port must be ${allowed.join(", ")}.`);
    }
    return { host, port, secure: port === 993 || port === 465 };
  };
  return { imap: endpoint("imap"), smtp: endpoint("smtp") };
}
