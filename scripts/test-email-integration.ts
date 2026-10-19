/**
 * Unit tests for business-mailbox sending: MIME building, header-injection
 * guards, credential encryption and the feature/recipient gates.
 *
 * Run: npm run test:email-integration
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { isEmailSendEnabled, isRecipientAllowed } from "../lib/email-integration/config";
import { decryptJson, encryptJson } from "../lib/email-integration/crypto";
import { extractBody, htmlToText, sanitizeEmailHtml } from "../lib/email-integration/mailbox/gmail";
import { classifyMessage } from "../lib/email-integration/mailbox/match";
import {
  customerSearchQuery,
  EMPTY_BACKFILL,
  queueNewWork,
  WHOLE_MAILBOX_QUERY,
} from "../lib/email-integration/mailbox/backfill";
import type { PlatformDocumentRef } from "../lib/email-integration/types";
import {
  extractAddresses,
  folderFromLabels,
  forwardSubject,
  parseSender,
  quoteForReply,
  replyReferences,
  replySubject,
} from "../lib/email-integration/mailbox/parse";
import { capabilitiesFromScopes } from "../lib/email-integration/scopes";
import {
  buildMimeMessage,
  generateMessageId,
  MimeHeaderError,
} from "../lib/email-integration/mime";

function headerBlock(message: string): string {
  return message.split("\r\n\r\n")[0];
}

describe("buildMimeMessage", () => {
  const base = {
    from: "owner@example.com",
    fromName: "Nira Electrical",
    to: ["customer@example.com"],
    subject: "Invoice INV 01 0001 from Nira Electrical",
    bodyText: "Hi Sam,\n\nPlease find attached your invoice.",
    messageId: "<abc@example.com>",
  };

  it("writes the sender, recipients, subject and message id headers", () => {
    const headers = headerBlock(
      buildMimeMessage({ ...base, cc: ["office@example.com"], headers: { "X-BMS-Outbox-Id": "o1" } }),
    );
    assert.match(headers, /^From: "Nira Electrical" <owner@example\.com>$/m);
    assert.match(headers, /^To: customer@example\.com$/m);
    assert.match(headers, /^Cc: office@example\.com$/m);
    assert.match(headers, /^Subject: Invoice INV 01 0001 from Nira Electrical$/m);
    assert.match(headers, /^Message-ID: <abc@example\.com>$/m);
    assert.match(headers, /^X-BMS-Outbox-Id: o1$/m);
    assert.match(headers, /^Content-Type: multipart\/mixed; boundary="bms_[a-f0-9]+"$/m);
  });

  it("omits Cc when there are no CC recipients", () => {
    assert.doesNotMatch(headerBlock(buildMimeMessage(base)), /^Cc:/m);
  });

  it("encodes non-ASCII subjects and display names as RFC 2047 words", () => {
    const headers = headerBlock(
      buildMimeMessage({ ...base, subject: "Devis — Café", fromName: "Zoë Plumbing" }),
    );
    const subject = headers.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m);
    assert.ok(subject, "subject should be encoded");
    assert.equal(Buffer.from(subject[1], "base64").toString("utf8"), "Devis — Café");
    assert.match(headers, /^From: =\?UTF-8\?B\?.+\?= <owner@example\.com>$/m);
  });

  it("escapes quotes in ASCII display names", () => {
    const headers = headerBlock(buildMimeMessage({ ...base, fromName: 'Bob "The Builder"' }));
    assert.match(headers, /^From: "Bob \\"The Builder\\"" <owner@example\.com>$/m);
  });

  it("rejects CR/LF in any header field", () => {
    assert.throws(
      () => buildMimeMessage({ ...base, subject: "Hi\r\nBcc: victim@example.com" }),
      MimeHeaderError,
    );
    assert.throws(
      () => buildMimeMessage({ ...base, to: ["a@example.com\nBcc: b@example.com"] }),
      MimeHeaderError,
    );
    assert.throws(
      () => buildMimeMessage({ ...base, fromName: "Name\rX" }),
      MimeHeaderError,
    );
  });

  it("base64-encodes the body and PDF attachment", () => {
    const pdf = Buffer.from("%PDF-1.4 test");
    const message = buildMimeMessage({
      ...base,
      attachments: [{ filename: "INV-01-0001.pdf", contentType: "application/pdf", content: pdf }],
    });
    assert.ok(message.includes(Buffer.from(base.bodyText, "utf8").toString("base64")));
    assert.match(message, /Content-Disposition: attachment; filename="INV-01-0001\.pdf"/);
    assert.ok(message.includes(pdf.toString("base64")));
    assert.match(message, /--bms_[a-f0-9]+--\r\n$/);
  });

  it("keeps base64 lines within 76 characters", () => {
    const message = buildMimeMessage({ ...base, bodyText: "x".repeat(2000) });
    const body = message.split("\r\n\r\n").slice(2).join("\r\n\r\n");
    for (const line of body.split("\r\n")) {
      assert.ok(line.length <= 76, `line too long: ${line.length}`);
    }
  });

  it("generates message ids on the sender's domain", () => {
    assert.match(generateMessageId("owner@nira.com.au"), /^<[0-9a-f-]+@nira\.com\.au>$/);
  });
});

describe("credential encryption", () => {
  beforeEach(() => {
    process.env.EMAIL_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips JSON and never stores plaintext", () => {
    const secret = { accessToken: "ya29.secret", refreshToken: "1//refresh", accessTokenExpiresAt: 1 };
    const sealed = encryptJson(secret);
    assert.ok(sealed.startsWith("v1."));
    assert.ok(!sealed.includes("secret") && !sealed.includes("refresh"));
    assert.deepEqual(decryptJson(sealed), secret);
  });

  it("uses a fresh IV for every encryption", () => {
    assert.notEqual(encryptJson({ a: 1 }), encryptJson({ a: 1 }));
  });

  it("rejects tampered ciphertext", () => {
    const parts = encryptJson({ a: 1 }).split(".");
    const tampered = Buffer.from(parts[3], "base64url");
    tampered[0] ^= 0xff;
    parts[3] = tampered.toString("base64url");
    assert.throws(() => decryptJson(parts.join(".")));
  });

  it("refuses to decrypt with a different key", () => {
    const sealed = encryptJson({ a: 1 });
    process.env.EMAIL_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    assert.throws(() => decryptJson(sealed));
  });

  it("requires a 32-byte key", () => {
    process.env.EMAIL_CREDENTIALS_KEY = randomBytes(16).toString("base64");
    assert.throws(() => encryptJson({ a: 1 }), /32 bytes/);
  });
});

describe("feature and recipient gates", () => {
  beforeEach(() => {
    delete process.env.EMAIL_SEND_ENABLED;
    delete process.env.EMAIL_SEND_PILOT_BUSINESS_IDS;
    delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  });

  it("is off unless EMAIL_SEND_ENABLED is true", () => {
    assert.equal(isEmailSendEnabled("b1"), false);
    process.env.EMAIL_SEND_ENABLED = "true";
    assert.equal(isEmailSendEnabled("b1"), true);
  });

  it("limits sending to pilot businesses when listed", () => {
    process.env.EMAIL_SEND_ENABLED = "true";
    process.env.EMAIL_SEND_PILOT_BUSINESS_IDS = "b1, b2";
    assert.equal(isEmailSendEnabled("b1"), true);
    assert.equal(isEmailSendEnabled("b3"), false);
    assert.equal(isEmailSendEnabled(null), false);
  });

  it("allows any recipient when no allowlist is set", () => {
    assert.equal(isRecipientAllowed("anyone@example.com"), true);
  });

  it("matches allowlisted addresses and @domains case-insensitively", () => {
    process.env.EMAIL_RECIPIENT_ALLOWLIST = "qa@softdev.global, @test.bmspros.com.au";
    assert.equal(isRecipientAllowed("QA@softdev.global"), true);
    assert.equal(isRecipientAllowed("someone@test.bmspros.com.au"), true);
    assert.equal(isRecipientAllowed("customer@gmail.com"), false);
  });
});

describe("mailbox parsing", () => {
  it("sorts messages into folders, and skips drafts and spam", () => {
    assert.equal(folderFromLabels(["INBOX", "UNREAD"]), "inbox");
    assert.equal(folderFromLabels(["SENT"]), "sent");
    assert.equal(folderFromLabels(["INBOX", "SENT"]), "sent");
    assert.equal(folderFromLabels(["DRAFT", "INBOX"]), null);
    assert.equal(folderFromLabels(["INBOX", "TRASH"]), "trash");
    assert.equal(folderFromLabels(["SPAM"]), null);
    assert.equal(folderFromLabels(["CATEGORY_PROMOTIONS"]), "archive");
  });

  it("parses sender headers", () => {
    assert.deepEqual(parseSender('"Sam Smith" <Sam@Example.com>'), {
      name: "Sam Smith",
      address: "sam@example.com",
    });
    assert.deepEqual(parseSender("Sam <sam@example.com>"), { name: "Sam", address: "sam@example.com" });
    assert.deepEqual(parseSender("sam@example.com"), { name: null, address: "sam@example.com" });
    assert.deepEqual(parseSender("<sam@example.com>"), { name: null, address: "sam@example.com" });
  });

  it("derives capabilities from granted scopes", () => {
    const send = "https://www.googleapis.com/auth/gmail.send";
    assert.deepEqual(capabilitiesFromScopes([send]), ["send"]);
    assert.deepEqual(
      capabilitiesFromScopes([send, "https://www.googleapis.com/auth/gmail.readonly"]),
      ["send", "read"],
    );
    assert.deepEqual(
      capabilitiesFromScopes([send, "https://www.googleapis.com/auth/gmail.modify"]),
      ["send", "read", "modify"],
    );
  });
});

describe("message body extraction", () => {
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

  it("reduces HTML to text without keeping scripts, styles or tags", () => {
    const text = htmlToText(
      '<style>p{color:red}</style><p>Hello &amp; welcome</p><script>alert(1)</script><div>Line two<br>Line three</div><img src="https://track.example/p.gif">',
    );
    assert.equal(text, "Hello & welcome\nLine two\nLine three");
    assert.doesNotMatch(text, /alert|color|track\.example|</);
  });

  it("decodes numeric entities and ignores invalid ones", () => {
    assert.equal(htmlToText("caf&#233; &#x1F600; &#99999999; &unknown;"), "café 😀 &#99999999; &unknown;");
  });

  it("prefers text/plain and lists attachments without downloading them", () => {
    const body = extractBody(
      {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Plain version") } },
              { mimeType: "text/html", body: { data: b64("<p>HTML version</p>") } },
            ],
          },
          { mimeType: "application/pdf", filename: "INV-01-0001.pdf", body: { size: 2048, attachmentId: "a1" } },
        ],
      },
      1000,
    );
    assert.equal(body.text, "Plain version");
    assert.deepEqual(body.attachments, [
      {
        name: "INV-01-0001.pdf",
        size: 2048,
        mimeType: "application/pdf",
        attachmentId: "a1",
        contentId: null,
        inline: false,
      },
    ]);
    assert.equal(body.html, "<p>HTML version</p>");
  });

  it("finds images embedded with cid: links, even without a file name", () => {
    const body = extractBody(
      {
        mimeType: "multipart/related",
        parts: [
          { mimeType: "text/html", body: { data: b64('<img src="cid:logo123">') } },
          {
            mimeType: "image/png",
            headers: [{ name: "Content-ID", value: "<logo123>" }, { name: "Content-Disposition", value: "inline" }],
            body: { attachmentId: "img1", size: 900 },
          },
        ],
      },
      1000,
    );
    assert.deepEqual(body.attachments, [
      { name: "logo123.png", size: 900, mimeType: "image/png", attachmentId: "img1", contentId: "logo123", inline: true },
    ]);
  });

  it("falls back to HTML text and truncates long messages", () => {
    const html = extractBody({ mimeType: "text/html", body: { data: b64("<b>Only HTML</b>") } }, 1000);
    assert.equal(html.text, "Only HTML");
    const long = extractBody({ mimeType: "text/plain", body: { data: b64("x".repeat(50)) } }, 10);
    assert.ok(long.text.startsWith("x".repeat(10)) && long.text.endsWith("[Message truncated]"));
  });
});

describe("platform link labels", () => {
  const customers = new Map([
    ["sam@example.com", new Set(["Sam Smith"])],
    ["shared@example.com", new Set(["Ann Lee", "Bob Lee"])],
  ]);
  const base = {
    threadId: "t1",
    ownAddress: "Owner@Business.com",
    customers,
    platformThreads: new Map<string, PlatformDocumentRef>(),
    linkedThreads: new Set<string>(),
    cc: "",
  };

  it("links mail with a known customer and names them", () => {
    const match = classifyMessage({ ...base, from: "Sam <SAM@example.com>", to: "owner@business.com" });
    assert.deepEqual(match, {
      method: "customer",
      customerEmails: ["sam@example.com"],
      customerName: "Sam Smith",
      document: null,
    });
  });

  it("labels other mail as not linked (it is still shown)", () => {
    assert.equal(
      classifyMessage({ ...base, from: "friend@gmail.com", to: "owner@business.com" }).method,
      "none",
    );
  });

  it("never treats the business's own address as a customer", () => {
    const own = new Map([["owner@business.com", new Set(["Owner"])]]);
    assert.equal(
      classifyMessage({ ...base, customers: own, from: "owner@business.com", to: "friend@gmail.com" }).method,
      "none",
    );
  });

  it("links replies in a thread the platform sent, or one already linked", () => {
    const quote: PlatformDocumentRef = { kind: "document", type: "quote", id: "q1", code: "QT 01 0003" };
    const match = classifyMessage({
      ...base,
      platformThreads: new Map([["t1", quote]]),
      from: "x@y.com",
      to: "owner@business.com",
    });
    assert.equal(match?.method, "platform_thread");
    assert.deepEqual(match?.document, quote);
    assert.equal(
      classifyMessage({ ...base, linkedThreads: new Set(["t1"]), from: "x@y.com", to: "owner@business.com" })?.method,
      "thread",
    );
  });

  it("does not guess a name when an address belongs to more than one customer", () => {
    const match = classifyMessage({ ...base, from: "shared@example.com", to: "owner@business.com" });
    assert.equal(match?.customerName, null);
    assert.deepEqual(match?.customerEmails, ["shared@example.com"]);
  });
});

describe("folders, replies and forwards", () => {
  it("maps Gmail labels to folders", () => {
    assert.equal(folderFromLabels(["INBOX"]), "inbox");
    assert.equal(folderFromLabels(["SENT", "INBOX"]), "sent");
    assert.equal(folderFromLabels(["TRASH", "INBOX"]), "trash");
    assert.equal(folderFromLabels(["CATEGORY_UPDATES"]), "archive");
    assert.equal(folderFromLabels(["DRAFT"]), null);
    assert.equal(folderFromLabels(["SPAM"]), null);
  });

  it("builds reply subjects and references without stacking prefixes", () => {
    assert.equal(replySubject("Quote QT 01 0001"), "Re: Quote QT 01 0001");
    assert.equal(replySubject("RE: Quote"), "RE: Quote");
    assert.equal(forwardSubject("Invoice"), "Fwd: Invoice");
    assert.equal(forwardSubject("Fwd: Invoice"), "Fwd: Invoice");
    assert.equal(replyReferences("<a@x>", "<b@x>"), "<a@x> <b@x>");
    assert.equal(replyReferences("", "<b@x>"), "<b@x>");
  });

  it("quotes the original in replies", () => {
    assert.equal(
      quoteForReply({ from: "Sam", date: "Mon", bodyText: "Hi\nThanks" }),
      "\n\nOn Mon, Sam wrote:\n> Hi\n> Thanks",
    );
  });

  it("extracts every address from headers", () => {
    assert.deepEqual(
      extractAddresses('"Sam, Jr" <Sam@Example.com>, bob@x.com', "Carol <carol@y.org>"),
      ["sam@example.com", "bob@x.com", "carol@y.org"],
    );
  });
});

describe("email HTML sanitising", () => {
  it("removes scripts, frames, forms, event handlers and javascript: links", () => {
    const clean = sanitizeEmailHtml(
      '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://x"></iframe>' +
        '<form action="https://x"><input name="p"></form><a href="javascript:alert(1)">x</a>' +
        '<img src="https://t.example/p.gif" onerror="x()"><meta http-equiv="refresh" content="0;url=https://x">',
    );
    assert.doesNotMatch(clean, /<script|<iframe|<form|<input|onclick|onerror|javascript:|<meta/i);
    assert.match(clean, /<p>Hi<\/p>/);
    assert.match(clean, /<img src="https:\/\/t\.example\/p\.gif">/);
  });

  it("keeps inline images but drops HTML data URLs", () => {
    assert.match(sanitizeEmailHtml('<img src="data:image/png;base64,AAAA">'), /data:image\/png/);
    assert.doesNotMatch(sanitizeEmailHtml('<a href="data:text/html,<b>x</b>">x</a>'), /data:text/);
  });

  it("returns sanitised HTML alongside the text body", () => {
    const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
    const body = extractBody(
      { mimeType: "text/html", body: { data: b64('<p>Hello</p><script>x()</script>') } },
      1000,
    );
    assert.equal(body.text, "Hello");
    assert.equal(body.html, "<p>Hello</p>");
  });
});

describe("full-history import queue", () => {
  it("searches every direction for a customer address, all time", () => {
    assert.equal(
      customerSearchQuery(["a@x.com"]),
      "{from:a@x.com to:a@x.com cc:a@x.com bcc:a@x.com}",
    );
  });

  it("queues each customer and platform thread once, never the business itself", () => {
    const customers = new Map<string, Set<string>>();
    for (let i = 0; i < 10; i += 1) customers.set(`c${i}@x.com`, new Set());
    customers.set("owner@biz.com", new Set());
    const platformThreads = new Map<string, PlatformDocumentRef>([
      ["t1", { kind: "document", type: "invoice", id: "i1", code: "INV 01 0001" }],
    ]);
    const first = queueNewWork(EMPTY_BACKFILL, { customers, platformThreads }, "Owner@Biz.com");
    assert.equal(first.searched.length, 10);
    assert.ok(!first.searched.includes("owner@biz.com"));
    // Platform thread first, then 10 addresses at 8 per search = 2 searches,
    // then one sweep of the whole mailbox.
    assert.deepEqual(first.queue[0], { type: "thread", threadId: "t1" });
    assert.equal(first.queue.filter((task) => task.type === "search").length, 3);
    assert.deepEqual(first.queue[first.queue.length - 1], {
      type: "search",
      query: WHOLE_MAILBOX_QUERY,
      pageToken: null,
    });
    assert.equal(first.done, false);

    // A later sync with one new customer queues just that search, ahead of
    // the sweep still in progress, and never a second sweep.
    customers.set("new@x.com", new Set());
    const sweep = { type: "search" as const, query: WHOLE_MAILBOX_QUERY, pageToken: "p9" };
    const second = queueNewWork({ ...first, queue: [sweep] }, { customers, platformThreads }, "owner@biz.com");
    assert.equal(second.queue.length, 2);
    assert.match((second.queue[0] as { query: string }).query, /new@x\.com/);
    assert.deepEqual(second.queue[1], sweep);
  });

  it("is done once the sweep and all searches have finished", () => {
    const first = queueNewWork(EMPTY_BACKFILL, { customers: new Map(), platformThreads: new Map() }, "o@b.com");
    assert.equal(first.queue.length, 1);
    const later = queueNewWork({ ...first, queue: [] }, { customers: new Map(), platformThreads: new Map() }, "o@b.com");
    assert.equal(later.done, true);
  });
});
