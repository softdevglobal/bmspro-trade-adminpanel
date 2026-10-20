/**
 * Mail servers for providers reached over IMAP/SMTP with an app password.
 * Adding a provider (AOL, iCloud, …) is a new entry here plus its adapters.
 */
export type ImapServerConfig = {
  /** Name used in messages, e.g. "Yahoo". */
  label: string;
  imap: { host: string; port: number };
  /** Implicit TLS (port 465). */
  smtp: { host: string; port: number };
  /**
   * True when the provider files mail sent over SMTP in Sent by itself.
   * Otherwise the adapter appends a copy to Sent after sending.
   */
  savesSentCopy: boolean;
  /** Where owners create an app password. */
  appPasswordHelpUrl: string;
};

export const YAHOO_SERVERS: ImapServerConfig = {
  label: "Yahoo",
  imap: { host: "imap.mail.yahoo.com", port: 993 },
  smtp: { host: "smtp.mail.yahoo.com", port: 465 },
  savesSentCopy: true,
  appPasswordHelpUrl: "https://help.yahoo.com/kb/SLN15241.html",
};
