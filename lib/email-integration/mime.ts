import "server-only";

import { randomUUID } from "node:crypto";

export type MimeAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export type MimeMessageInput = {
  from: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  /** Gmail removes Bcc from delivered copies; it only routes the message. */
  bcc?: string[];
  subject: string;
  bodyText: string;
  messageId: string;
  /** Extra X- headers, e.g. the outbox correlation id. */
  headers?: Record<string, string>;
  attachments?: MimeAttachment[];
};

export class MimeHeaderError extends Error {}

function assertHeaderSafe(value: string, field: string): string {
  if (/[\r\n]/.test(value)) {
    throw new MimeHeaderError(`${field} must not contain line breaks.`);
  }
  return value;
}

/** RFC 2047 encoded-word for non-ASCII header text. */
function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function formatMailbox(address: string, name?: string | null): string {
  assertHeaderSafe(address, "Address");
  if (!name?.trim()) return address;
  const display = assertHeaderSafe(name.trim(), "Display name");
  const encoded = /^[\x20-\x7e]*$/.test(display)
    ? `"${display.replace(/["\\]/g, "\\$&")}"`
    : encodeHeaderText(display);
  return `${encoded} <${address}>`;
}

function wrapBase64(buffer: Buffer): string {
  return (buffer.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

export function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1]?.trim() || "bmspros.com.au";
  return `<${randomUUID()}@${domain}>`;
}

/** Builds a multipart/mixed RFC 5322 message with a plain-text body. */
export function buildMimeMessage(input: MimeMessageInput): string {
  const boundary = `bms_${randomUUID().replace(/-/g, "")}`;
  const headers = [
    `From: ${formatMailbox(input.from, input.fromName)}`,
    `To: ${input.to.map((address) => formatMailbox(address)).join(", ")}`,
    ...(input.cc?.length
      ? [`Cc: ${input.cc.map((address) => formatMailbox(address)).join(", ")}`]
      : []),
    ...(input.bcc?.length
      ? [`Bcc: ${input.bcc.map((address) => formatMailbox(address)).join(", ")}`]
      : []),
    `Subject: ${encodeHeaderText(assertHeaderSafe(input.subject, "Subject"))}`,
    `Message-ID: ${assertHeaderSafe(input.messageId, "Message-ID")}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    ...Object.entries(input.headers ?? {}).map(
      ([key, value]) =>
        `${assertHeaderSafe(key, "Header name")}: ${assertHeaderSafe(value, key)}`,
    ),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const parts = [
    [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(Buffer.from(input.bodyText, "utf8")),
    ].join("\r\n"),
    ...(input.attachments ?? []).map((attachment) => {
      const filename = assertHeaderSafe(attachment.filename, "Attachment name")
        .replace(/["\\]/g, "_");
      const contentType = assertHeaderSafe(attachment.contentType, "Attachment type");
      // ASCII names go in plain; others use RFC 2231 so they survive intact.
      const ascii = /^[\x20-\x7e]*$/.test(filename);
      const nameParam = ascii
        ? `filename="${filename}"`
        : `filename*=UTF-8''${encodeURIComponent(filename)}`;
      return [
        `--${boundary}`,
        `Content-Type: ${contentType}; ${ascii ? `name="${filename}"` : `name*=UTF-8''${encodeURIComponent(filename)}`}`,
        `Content-Disposition: attachment; ${nameParam}`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(attachment.content),
      ].join("\r\n");
    }),
  ];

  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}
