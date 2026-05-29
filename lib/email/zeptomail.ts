import "server-only";

import { SendMailClient } from "zeptomail";

const ZEPTOMAIL_URL =
  process.env.ZEPTOMAIL_URL ?? "https://api.zeptomail.com.au/v1.1/email";
const ZEPTOMAIL_TOKEN = process.env.ZEPTOMAIL_TOKEN ?? "";
const FROM_ADDRESS =
  process.env.ZEPTOMAIL_FROM_ADDRESS ?? "noreply@bmspros.com.au";
const FROM_NAME = process.env.ZEPTOMAIL_FROM_NAME ?? "BMS Pro Trade";

let cachedClient: SendMailClient | null = null;

function getClient(): SendMailClient | null {
  if (!ZEPTOMAIL_TOKEN) return null;
  if (!cachedClient) {
    cachedClient = new SendMailClient({
      url: ZEPTOMAIL_URL,
      token: ZEPTOMAIL_TOKEN,
    });
  }
  return cachedClient;
}

export type SendEmailInput = {
  to: string;
  toName?: string | null;
  subject: string;
  htmlBody: string;
};

/**
 * Sends a transactional email through ZeptoMail. Best-effort: never throws so
 * notification flows are not blocked when email delivery fails or is not
 * configured.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const client = getClient();
  const recipient = input.to?.trim();
  if (!client || !recipient) {
    if (!client) {
      console.warn("[zeptomail] skipped — ZEPTOMAIL_TOKEN is not configured.");
    }
    return false;
  }

  try {
    await client.sendMail({
      from: { address: FROM_ADDRESS, name: FROM_NAME },
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
    });
    return true;
  } catch (error) {
    console.error("[zeptomail] failed to send email", error);
    return false;
  }
}
