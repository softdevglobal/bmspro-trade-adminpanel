import "server-only";

import { SendMailClient } from "zeptomail";

const ZEPTOMAIL_URL =
  process.env.ZEPTOMAIL_URL ?? "https://api.zeptomail.com.au/v1.1/email";

/**
 * Two separate ZeptoMail senders, each backed by its own mail-agent token:
 *  - `system`  → noreply@bmspros.com.au (account creation, onboarding, etc.)
 *  - `request` → request@bmspros.com.au (inspection / booking request updates)
 */
export type EmailSender = "system" | "request";

type SenderConfig = {
  token: string;
  fromAddress: string;
  fromName: string;
};

function readSenderConfig(sender: EmailSender): SenderConfig {
  if (sender === "request") {
    return {
      token:
        process.env.ZEPTOMAIL_REQUEST_TOKEN ??
        process.env.ZEPTOMAIL_TOKEN ??
        "",
      fromAddress:
        process.env.ZEPTOMAIL_REQUEST_FROM_ADDRESS ?? "request@bmspros.com.au",
      fromName: process.env.ZEPTOMAIL_REQUEST_FROM_NAME ?? "BMS Pro Trade",
    };
  }
  return {
    token:
      process.env.ZEPTOMAIL_SYSTEM_TOKEN ?? process.env.ZEPTOMAIL_TOKEN ?? "",
    fromAddress:
      process.env.ZEPTOMAIL_SYSTEM_FROM_ADDRESS ?? "noreply@bmspros.com.au",
    fromName: process.env.ZEPTOMAIL_SYSTEM_FROM_NAME ?? "BMS Pro Trade",
  };
}

const clientCache = new Map<string, SendMailClient>();

function getClient(token: string): SendMailClient | null {
  if (!token) return null;
  let client = clientCache.get(token);
  if (!client) {
    client = new SendMailClient({ url: ZEPTOMAIL_URL, token });
    clientCache.set(token, client);
  }
  return client;
}

export type SendEmailInput = {
  /** Which sender mailbox to send from. Defaults to the system mailbox. */
  sender?: EmailSender;
  to: string;
  toName?: string | null;
  subject: string;
  htmlBody: string;
  replyTo?: string | null;
};

/**
 * Sends a transactional email through ZeptoMail. Best-effort: never throws so
 * notification flows are not blocked when email delivery fails or is not
 * configured.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const sender = input.sender ?? "system";
  const config = readSenderConfig(sender);
  const client = getClient(config.token);
  const recipient = input.to?.trim();

  if (!recipient) {
    console.warn("[email] skipped — no recipient address.", {
      sender,
      subject: input.subject,
    });
    return false;
  }

  if (!client) {
    console.warn(`[email] skipped — no token for "${sender}" sender.`, {
      subject: input.subject,
      to: recipient,
    });
    return false;
  }

  console.log("[email] sending…", {
    sender,
    from: config.fromAddress,
    to: recipient,
    subject: input.subject,
  });

  try {
    const replyTo = input.replyTo?.trim();
    await client.sendMail({
      from: { address: config.fromAddress, name: config.fromName },
      to: [
        {
          email_address: {
            address: recipient,
            name: input.toName?.trim() || recipient,
          },
        },
      ],
      subject: input.subject,
      htmlbody: input.htmlBody,
      ...(replyTo
        ? { reply_to: [{ address: replyTo, name: replyTo }] }
        : {}),
    });
    console.log("[email] sent OK", {
      sender,
      from: config.fromAddress,
      to: recipient,
      subject: input.subject,
    });
    return true;
  } catch (error) {
    console.error("[email] send FAILED", {
      sender,
      from: config.fromAddress,
      to: recipient,
      subject: input.subject,
      error,
    });
    return false;
  }
}
