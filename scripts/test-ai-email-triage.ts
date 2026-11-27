import assert from "node:assert/strict";
import test from "node:test";

import type { Firestore } from "firebase-admin/firestore";

import { isSortableNewMail, queueReceivedMail } from "../lib/ai/email/events";
import {
  parseHeaderBlock,
  pickTriageHeaders,
  readTriageHeaders,
  TRIAGE_HEADER_NAMES,
  type TriageHeaders,
} from "../lib/ai/email/headers";
import {
  checkSenderAuthentication,
  mayShareOwnDetails,
  parseAuthenticationResults,
  senderIdentity,
  type IdentityInput,
} from "../lib/ai/email/identity";
import { DEFAULT_STYLE } from "../lib/ai/email/style";
import { precheck, type PrecheckInput } from "../lib/ai/email/precheck";
import {
  addSender,
  listSenders,
  lookupSender,
  maskSender,
  MAX_SENDERS_PER_LIST,
  parseSenderValue,
  removeSender,
  senderKey,
} from "../lib/ai/email/senders";
import {
  emailTriageAvailable,
  emailTriageCutoff,
  getEmailSettings,
  mapEmailSettings,
  triageCutoff,
  updateEmailSettings,
} from "../lib/ai/email/settings";
import { gmailMailbox } from "../lib/email-integration/mailbox/gmail";
import { messageDocId } from "../lib/email-integration/mailbox/ids";
import { microsoftMailbox } from "../lib/email-integration/mailbox/microsoft";
import type { MailboxMetadata } from "../lib/email-integration/mailbox/provider";
import { fakeFirestore } from "./fake-firestore";

const credentials = { accessToken: "token", accessTokenExpiresAt: Date.now() + 3_600_000, refreshToken: "refresh" };
const ON = { AI_AGENT_ENABLED: "true", AI_EMAIL_TRIAGE_ENABLED: "true" };
const DAY = 24 * 60 * 60_000;
const ENABLED_AT = Date.UTC(2026, 10, 26, 0, 0);

// ---- Headers (§4.1, §9.2) -------------------------------------------------------------

test("only the triage headers are kept, in message order, with lowercase names", () => {
  const picked = pickTriageHeaders([
    { name: "Authentication-Results", value: "mx.google.com;\r\n dmarc=pass" },
    { name: "X-Spam-Score", value: "drop me" },
    { name: "Received", value: "drop me too" },
    { name: "Authentication-Results", value: "attacker.example; dmarc=pass" },
    { name: "Reply-To", value: 42 },
    { name: "List-Id", value: "x".repeat(5000) },
  ]);
  assert.deepEqual(picked.map((line) => line.name), ["authentication-results", "authentication-results", "list-id"]);
  assert.equal(picked[0].value, "mx.google.com; dmarc=pass");
  assert.equal(picked[2].value.length, 2000);
});

test("an IMAP header block is split into lines with folded lines joined", () => {
  const block = [
    "Authentication-Results: mx.provider.example;",
    "\tdkim=pass header.d=customer.example;",
    " dmarc=pass",
    "Reply-To: Someone <other@elsewhere.example>",
    "Return-Path: <>",
    "",
  ].join("\r\n");
  assert.deepEqual(parseHeaderBlock(block), [
    { name: "authentication-results", value: "mx.provider.example; dkim=pass header.d=customer.example; dmarc=pass" },
    { name: "reply-to", value: "Someone <other@elsewhere.example>" },
    { name: "return-path", value: "<>" },
  ]);
});

test("triage facts: the top Authentication-Results line, Reply-To, list and automatic-mail signs", () => {
  const facts = readTriageHeaders({
    headers: [
      { name: "authentication-results", value: "mx.google.com; dmarc=pass header.from=customer.example" },
      { name: "authentication-results", value: "forged.example; dmarc=pass" },
      { name: "reply-to", value: "Billing <Pay@Elsewhere.example>, second@elsewhere.example" },
      { name: "list-unsubscribe", value: "<mailto:unsubscribe@shop.example>" },
      { name: "auto-submitted", value: "Auto-Replied; owner-email=\"a@b.c\"" },
      { name: "precedence", value: "Bulk" },
      { name: "x-autoreply", value: "yes" },
      { name: "return-path", value: "< >" },
      { name: "content-type", value: "multipart/report; report-type=delivery-status" },
    ],
    labels: ["INBOX", "CATEGORY_PROMOTIONS"],
    inferenceClassification: null,
  });
  assert.deepEqual(facts, {
    authenticationResults: "mx.google.com; dmarc=pass header.from=customer.example",
    replyTo: ["pay@elsewhere.example", "second@elsewhere.example"],
    listUnsubscribe: true,
    listId: null,
    autoSubmitted: "auto-replied",
    precedence: "bulk",
    autoReplyHeader: true,
    autoResponseSuppress: false,
    nullReturnPath: true,
    deliveryReport: true,
    gmailCategory: "promotions",
    outlookFocused: null,
  });

  const plain = readTriageHeaders({ headers: [], labels: [], inferenceClassification: "other" });
  assert.equal(plain.authenticationResults, null);
  assert.deepEqual(plain.replyTo, []);
  assert.equal(plain.autoSubmitted, null);
  assert.equal(plain.outlookFocused, false);
  assert.equal(readTriageHeaders({ headers: [], labels: [], inferenceClassification: "focused" }).outlookFocused, true);
});

test("Gmail reads the triage headers and labels in one metadata request", async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    urls.push(new URL(String(url)));
    if (urls.length === 2) return Response.json({ error: { errors: [{ reason: "notFound" }] } }, { status: 404 });
    return Response.json({
      labelIds: ["INBOX", "CATEGORY_UPDATES"],
      payload: { headers: [
        { name: "Authentication-Results", value: "mx.google.com; dmarc=pass" },
        { name: "Subject", value: "not asked for" },
      ] },
    });
  });

  const result = await gmailMailbox.getHeaders(credentials, "18c0ffee");
  assert.equal(urls[0].pathname, "/gmail/v1/users/me/messages/18c0ffee");
  assert.equal(urls[0].searchParams.get("format"), "metadata");
  assert.deepEqual(urls[0].searchParams.getAll("metadataHeaders"), [...TRIAGE_HEADER_NAMES]);
  assert.deepEqual(result, {
    headers: [{ name: "authentication-results", value: "mx.google.com; dmarc=pass" }],
    labels: ["INBOX", "CATEGORY_UPDATES"],
    inferenceClassification: null,
  });
  assert.equal(await gmailMailbox.getHeaders(credentials, "gone"), null);
});

test("Outlook reads internet headers and the Focused verdict in one request", async (t) => {
  const urls: string[] = [];
  let reply: Response = Response.json({
    internetMessageHeaders: [
      { name: "Received", value: "drop" },
      { name: "List-Unsubscribe", value: "<https://shop.example/u>" },
    ],
    inferenceClassification: "other",
  });
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    urls.push(String(url));
    return reply;
  });

  const result = await microsoftMailbox.getHeaders(credentials, "AAMk/abc+=");
  assert.ok(urls[0].endsWith("/me/messages/AAMk%2Fabc%2B%3D?$select=internetMessageHeaders,inferenceClassification"));
  assert.deepEqual(result, {
    headers: [{ name: "list-unsubscribe", value: "<https://shop.example/u>" }],
    labels: [],
    inferenceClassification: "other",
  });

  reply = Response.json({ internetMessageHeaders: null, inferenceClassification: "focused" });
  assert.deepEqual((await microsoftMailbox.getHeaders(credentials, "internal"))?.headers, []);
  reply = new Response("{}", { status: 404 });
  assert.equal(await microsoftMailbox.getHeaders(credentials, "gone"), null);
});

// ---- Settings and the per-business switch (§16) -------------------------------------

test("sorting needs both platform switches", () => {
  assert.equal(emailTriageAvailable({}), false);
  assert.equal(emailTriageAvailable({ AI_EMAIL_TRIAGE_ENABLED: "true" }), false);
  assert.equal(emailTriageAvailable({ AI_AGENT_ENABLED: "true" }), false);
  assert.equal(emailTriageAvailable(ON), true);
});

test("settings default to off, and 'on' without a date counts as off", () => {
  assert.deepEqual(mapEmailSettings(undefined), {
    enabled: false, enabledAt: null, paused: false, pausedAt: null, summaryHour: 17, lastSummaryDate: null, lastSummaryAt: null, kindsOff: [], style: DEFAULT_STYLE, safetyReplyVersion: null,
  });
  assert.equal(mapEmailSettings({ summaryHour: 25 }).summaryHour, 17);
  assert.equal(mapEmailSettings({ summaryHour: 7 }).summaryHour, 7);
  assert.equal(mapEmailSettings({ enabled: true }).enabled, false);
  assert.equal(triageCutoff(mapEmailSettings({ enabled: true })), null);
});

test("switching on stamps the cutoff once; off and on again starts a new one", async () => {
  const { db, table } = fakeFirestore();
  const first = await updateEmailSettings(db, "business-a", { enabled: true }, "owner-a", ENABLED_AT);
  assert.deepEqual([first.enabled, first.enabledAt, first.paused, first.pausedAt], [true, ENABLED_AT, false, null]);
  assert.equal((await updateEmailSettings(db, "business-a", { summaryHour: 8 }, "owner-a", ENABLED_AT)).summaryHour, 8);
  assert.equal((await updateEmailSettings(db, "business-a", { summaryHour: 99 }, "owner-a", ENABLED_AT)).summaryHour, 8);

  // A double tap keeps the original cutoff.
  await updateEmailSettings(db, "business-a", { enabled: true }, "owner-a", ENABLED_AT + 60_000);
  assert.equal(triageCutoff(await getEmailSettings(db, "business-a")), ENABLED_AT);

  await updateEmailSettings(db, "business-a", { enabled: false }, "owner-a", ENABLED_AT + DAY);
  assert.equal(triageCutoff(await getEmailSettings(db, "business-a")), null);
  await updateEmailSettings(db, "business-a", { enabled: true }, "owner-a", ENABLED_AT + 2 * DAY);
  assert.equal(triageCutoff(await getEmailSettings(db, "business-a")), ENABLED_AT + 2 * DAY);

  const paused = await updateEmailSettings(db, "business-a", { paused: true }, "owner-a", ENABLED_AT + 3 * DAY);
  assert.deepEqual([paused.paused, paused.pausedAt, paused.enabled], [true, ENABLED_AT + 3 * DAY, true]);
  const resumed = await updateEmailSettings(db, "business-a", { paused: false }, "owner-a", ENABLED_AT + 4 * DAY);
  assert.deepEqual([resumed.paused, resumed.pausedAt], [false, null]);
  assert.equal(table("ai_email_settings").get("business-a")?.updatedBy, "owner-a");
});

test("with the platform switches off the cutoff is null and no settings are read", async () => {
  const untouchable = { collection: () => assert.fail("must not read") } as unknown as Firestore;
  assert.equal(await emailTriageCutoff(untouchable, "business-a", {}), null);

  const { db } = fakeFirestore();
  await updateEmailSettings(db, "business-a", { enabled: true }, "owner-a", ENABLED_AT);
  assert.equal(await emailTriageCutoff(db, "business-a", ON), ENABLED_AT);
  assert.equal(await emailTriageCutoff(db, "business-b", ON), null);
});

// ---- email.received events (§14.1, T01, T02) -------------------------------------------

const mail = (id: string, date: number | null, folder: MailboxMetadata["folder"] = "inbox") => ({ id, date, folder });

test("only new Inbox mail at or after the cutoff is sortable", () => {
  assert.equal(isSortableNewMail(mail("a", ENABLED_AT), ENABLED_AT), true);
  assert.equal(isSortableNewMail(mail("a", ENABLED_AT - 1), ENABLED_AT), false);
  assert.equal(isSortableNewMail(mail("a", null), ENABLED_AT), false);
  assert.equal(isSortableNewMail(mail("a", ENABLED_AT + 1, "sent"), ENABLED_AT), false);
  assert.equal(isSortableNewMail(mail("a", ENABLED_AT + 1, "archive"), ENABLED_AT), false);
  assert.equal(isSortableNewMail(mail("a", ENABLED_AT + 1, null), ENABLED_AT), false);
});

test("T01: switched on with 5 years of mail already there, only mail after the switch makes events", async () => {
  const { db, table } = fakeFirestore();
  const history = Array.from({ length: 5 * 365 }, (_, day) => mail(`old-${day}`, ENABLED_AT - (day + 1) * DAY));
  const queued = await queueReceivedMail(db, {
    businessId: "business-a",
    connectionId: "conn-a",
    messages: [...history, mail("new-1", ENABLED_AT + 60_000), mail("sent-1", ENABLED_AT + 60_000, "sent")],
    cutoff: ENABLED_AT,
  });
  assert.equal(queued, 1);
  const events = table("ai_agent_events");
  assert.deepEqual([...events.keys()], [`email.received:${messageDocId("conn-a", "new-1")}`]);
  assert.equal(events.get(`email.received:${messageDocId("conn-a", "new-1")}`)?.businessId, "business-a");

  // Sorting off: nothing at all.
  assert.equal(await queueReceivedMail(db, {
    businessId: "business-a", connectionId: "conn-a", messages: [mail("new-2", ENABLED_AT + DAY)], cutoff: null,
  }), 0);
  assert.equal(events.size, 1);
});

test("T02: the same message synced twice makes one event", async () => {
  const { db, table } = fakeFirestore();
  // An Outlook id has characters a Firestore id can't hold; the stored message's id is hashed.
  const outlookId = "AAMkAGI2/THU+=";
  const input = { businessId: "business-a", connectionId: "conn-a", messages: [mail(outlookId, ENABLED_AT + 1)], cutoff: ENABLED_AT };
  assert.equal(await queueReceivedMail(db, input), 1);
  assert.equal(await queueReceivedMail(db, input), 0);
  assert.deepEqual([...table("ai_agent_events").keys()], [`email.received:${messageDocId("conn-a", outlookId)}`]);
});

test("one failed event write doesn't stop the others", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const { db, table } = fakeFirestore();
  const flaky = {
    collection: (name: string) => {
      const collection = db.collection(name);
      return {
        ...collection,
        doc: (id: string) => id.endsWith("_bad")
          ? { create: async () => { throw new Error("unavailable"); } }
          : collection.doc(id),
      };
    },
  } as unknown as Firestore;
  const queued = await queueReceivedMail(flaky, {
    businessId: "business-a", connectionId: "conn-a",
    messages: [mail("bad", ENABLED_AT + 1), mail("good", ENABLED_AT + 2)], cutoff: ENABLED_AT,
  });
  assert.equal(queued, 1);
  assert.equal(table("ai_agent_events").size, 1);
});

// ---- Authentication-Results (§9.2) ------------------------------------------------------

const GMAIL_PASS = "mx.google.com; dkim=pass header.i=@customer.example header.s=s1 header.b=AbC; spf=pass (google.com: domain of priya@customer.example designates 1.2.3.4 as permitted sender) smtp.mailfrom=priya@customer.example; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=customer.example";

test("Authentication-Results lines are parsed, with or without the server's name", () => {
  const gmail = parseAuthenticationResults(GMAIL_PASS);
  assert.equal(gmail.authservId, "mx.google.com");
  assert.deepEqual(gmail.results.map((result) => `${result.method}=${result.result}`), ["dkim=pass", "spf=pass", "dmarc=pass"]);
  assert.equal(gmail.results[2].props["header.from"], "customer.example");

  const microsoft = parseAuthenticationResults("spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=customer.example; dkim=pass (signature was verified) header.d=customer.example;dmarc=bestguesspass action=none header.from=customer.example;compauth=pass reason=109");
  assert.equal(microsoft.authservId, null);
  assert.deepEqual(microsoft.results.map((result) => result.method), ["spf", "dkim", "dmarc", "compauth"]);

  const yahoo = parseAuthenticationResults("atlas101.free.mail.ne1.yahoo.com; dkim=pass header.i=@customer.example; dmarc=pass(p=REJECT) header.from=customer.example;");
  assert.equal(yahoo.authservId, "atlas101.free.mail.ne1.yahoo.com");
  assert.equal(yahoo.results[1].result, "pass");
});

test("sender authentication: only the provider's own line counts, and it must match the From domain", () => {
  const check = (provider: "google" | "microsoft" | "yahoo" | "imap", line: string | null, from = "priya@customer.example") =>
    checkSenderAuthentication({ provider, authenticationResults: line, fromAddress: from });
  assert.equal(check("google", GMAIL_PASS), "pass");
  assert.equal(check("google", null), "missing");
  // A line the sender wrote themselves, with someone else's server name, doesn't count.
  assert.equal(check("google", "evil.example; dmarc=pass header.from=customer.example"), "missing");
  assert.equal(check("google", "mx.google.com; dmarc=fail (p=REJECT) header.from=customer.example"), "fail");
  assert.equal(check("google", "mx.google.com; dmarc=pass header.from=other.example"), "fail");
  assert.equal(check("google", GMAIL_PASS, "billing@other.example"), "fail");
  // No DMARC policy: an aligned DKIM signature passes, an unaligned one doesn't.
  assert.equal(check("google", "mx.google.com; dkim=pass header.i=@customer.example; spf=pass smtp.mailfrom=customer.example"), "pass");
  assert.equal(check("google", "mx.google.com; dkim=pass header.i=@mailer.example; spf=pass smtp.mailfrom=customer.example"), "fail");
  assert.equal(check("google", "mx.google.com; dkim=pass header.d=customer.example", "priya@mail.customer.example"), "pass");
  assert.equal(check("google", "mx.google.com; spf=pass smtp.mailfrom=customer.example"), "fail");
  // Microsoft stamps its line without a name; "bestguesspass" means no DMARC policy.
  assert.equal(check("microsoft", "spf=pass smtp.mailfrom=customer.example; dkim=pass header.d=customer.example;dmarc=bestguesspass action=none header.from=customer.example"), "pass");
  assert.equal(check("microsoft", "spf=fail smtp.mailfrom=customer.example; dkim=none header.d=none;dmarc=fail action=oreject header.from=customer.example"), "fail");
  assert.equal(check("yahoo", "atlas1.mail.yahoo.com; dmarc=pass(p=REJECT) header.from=customer.example"), "pass");
  assert.equal(check("yahoo", "mx.google.com; dmarc=pass header.from=customer.example"), "missing");
  // Other IMAP hosts aren't trusted yet: they fail closed.
  assert.equal(check("imap", "mx.zohomail.com; dmarc=pass header.from=customer.example"), "missing");
});

// ---- Identity levels (§9.2, T21 to T25) ---------------------------------------------------

const CUSTOMERS = new Map<string, Set<string>>([
  ["priya@customer.example", new Set(["Priya Shah"])],
  ["priya.work@customer.example", new Set(["Priya Shah"])],
  ["office@shared.example", new Set(["Tom Lee", "Ann Lee"])],
  ["mary@brown.example", new Set(["Mary Brown"])],
]);

function identity(overrides: Partial<IdentityInput> = {}) {
  return senderIdentity({
    from: "Priya Shah <Priya@Customer.example>",
    to: "Jobs <jobs@business.example>",
    cc: "",
    subject: "When is my job?",
    ownAddress: "jobs@business.example",
    replyTo: [],
    auth: "pass",
    customers: CUSTOMERS,
    platformThreadRecipients: null,
    ...overrides,
  });
}

test("a saved customer whose email passed authentication is a verified sender", () => {
  const result = identity();
  assert.deepEqual(
    [result.level, result.senderAddress, result.customerName, result.replyAddress, result.reasons],
    ["verified_sender", "priya@customer.example", "Priya Shah", "priya@customer.example", []],
  );
  assert.equal(mayShareOwnDetails(result), true);
  assert.equal(identity({ platformThreadRecipients: ["PRIYA@customer.example"] }).level, "verified_thread");
  assert.equal(identity({ platformThreadRecipients: ["someone@else.example"] }).level, "verified_sender");
});

test("T21: a customer's address in From but DMARC fails is only a contact match: no job details", () => {
  const failed = identity({ auth: "fail" });
  assert.deepEqual([failed.level, failed.reasons], ["contact_match", ["auth_failed"]]);
  assert.equal(mayShareOwnDetails(failed), false);
  assert.deepEqual(identity({ auth: "missing" }).reasons, ["auth_missing"]);
});

test("T22: a verified customer with an unknown address in Cc gets no private details", () => {
  const withStranger = identity({ cc: "Someone <stranger@else.example>" });
  assert.equal(withStranger.level, "verified_sender");
  assert.deepEqual(withStranger.otherRecipients, ["stranger@else.example"]);
  assert.equal(mayShareOwnDetails(withStranger), false);
  // Her own second address on record doesn't count as someone else.
  assert.equal(mayShareOwnDetails(identity({ cc: "priya.work@customer.example" })), true);
});

test("T23: Reply-To pointing elsewhere lowers trust, and replies still go to the address on record", () => {
  const result = identity({ replyTo: ["pay@elsewhere.example"] });
  assert.deepEqual([result.level, result.reasons], ["contact_match", ["reply_to_differs"]]);
  assert.equal(result.replyAddress, "priya@customer.example");
  assert.equal(identity({ replyTo: ["priya@customer.example"] }).level, "verified_sender");
});

test("T24: only the sender's own address is looked up, never a name in the email", () => {
  const result = identity({ from: "Stranger <stranger@else.example>", subject: "Please check Mary Brown's invoice" });
  assert.deepEqual([result.level, result.customerName, result.reasons], ["none", null, ["not_on_record"]]);
  // A customer's address written in the display name is not the sender.
  const spoof = identity({ from: "\"priya@customer.example\" <attacker@evil.example>" });
  assert.deepEqual([spoof.level, spoof.senderAddress], ["none", "attacker@evil.example"]);
});

test("T25: two customer names on one address is a contact match, and the owner picks", () => {
  const result = identity({ from: "office@shared.example" });
  assert.deepEqual([result.level, result.customerName, result.reasons], ["contact_match", null, ["shared_address"]]);
});

test("forwarded email, our own address and a broken From are never verified", () => {
  assert.deepEqual(identity({ subject: "Fwd: my invoice" }).reasons, ["forwarded"]);
  assert.equal(identity({ from: "jobs@business.example" }).level, "none");
  assert.equal(identity({ from: "a@x.example, b@y.example" }).senderAddress, null);
});

// ---- Pre-check (§4.1, T03, T04) ---------------------------------------------------------

const NO_HEADERS: TriageHeaders = {
  authenticationResults: null, replyTo: [], listUnsubscribe: false, listId: null, autoSubmitted: null,
  precedence: null, autoReplyHeader: false, autoResponseSuppress: false, nullReturnPath: false,
  deliveryReport: false, gmailCategory: null, outlookFocused: null,
};

function check(overrides: Partial<PrecheckInput> = {}, headers: Partial<TriageHeaders> = {}) {
  return precheck({
    from: "Sam <sam@newlead.example>",
    subject: "Can someone check our gate intercom?",
    folder: "inbox",
    ownAddress: "jobs@business.example",
    headers: { ...NO_HEADERS, ...headers },
    senderLists: { private: false, blocked: null },
    match: { method: "none", customerEmails: [], customerName: null, document: null },
    senderIsCustomer: false,
    ...overrides,
  });
}

test("ordinary new mail goes on to the AI and may be answered", () => {
  const result = check();
  assert.deepEqual([result.outcome, result.stop, result.neverReply, result.candidateKind], ["none", false, false, null]);
});

test("mail the business sent itself is skipped", () => {
  assert.equal(check({ from: "Jobs <JOBS@business.example>" }).outcome, "sent_by_us");
  assert.equal(check({ folder: "sent" }).outcome, "sent_by_us");
});

test("T03: a private sender stops everything first, before any other signal is read", () => {
  const result = check(
    { senderLists: { private: true, blocked: { kind: "address", folder: "Blocked" } }, senderIsCustomer: true,
      match: { method: "customer", customerEmails: ["sam@newlead.example"], customerName: "Sam", document: null } },
    { autoSubmitted: "auto-replied", gmailCategory: "promotions", listUnsubscribe: true },
  );
  assert.deepEqual(
    [result.outcome, result.stop, result.neverReply, result.signals, result.promotionSignals, result.blocked],
    ["private", true, true, [], [], null],
  );
});

test("T04: out-of-office replies, auto-replies and bounces are system mail and stop", () => {
  const system = (overrides: Partial<PrecheckInput>, headers: Partial<TriageHeaders> = {}) => {
    const result = check(overrides, headers);
    assert.deepEqual([result.outcome, result.stop, result.neverReply], ["system", true, true], JSON.stringify(result.signals));
    return result.signals;
  };
  assert.deepEqual(system({ subject: "Automatic reply: Quote Q-1042" }), ["out_of_office"]);
  assert.deepEqual(system({ subject: "Out of Office until Monday" }), ["out_of_office"]);
  // Another business's Sophie answering ours: her replies carry Auto-Submitted: auto-replied, so no loop.
  assert.deepEqual(system({ subject: "Re: Thanks!" }, { autoSubmitted: "auto-replied" }), ["auto_replied"]);
  assert.deepEqual(system({}, { autoReplyHeader: true }), ["auto_reply_header"]);
  assert.deepEqual(system({}, { precedence: "auto_reply" }), ["precedence_auto_reply"]);
  assert.deepEqual(system({ from: "Mail Delivery Subsystem <MAILER-DAEMON@googlemail.com>" }), ["bounce"]);
  assert.deepEqual(system({}, { nullReturnPath: true, deliveryReport: true }), ["bounce"]);
  // Headers that couldn't be read: the sender and subject checks still run.
  assert.equal(check({ headers: null }).outcome, "none");
  assert.equal(check({ headers: null, subject: "Automatic reply: hello" }).outcome, "system");
});

test("T04: noreply senders, lists and bulk mail are still sorted, but never answered", () => {
  const noreply = check({ from: "Acme Accounts <no-reply@acme-supplies.example>", subject: "Invoice INV-88213" });
  assert.deepEqual([noreply.outcome, noreply.stop, noreply.neverReply, noreply.signals], ["none", false, true, ["noreply_sender"]]);
  assert.deepEqual(check({ from: "donotreply@bank.example" }).signals, ["noreply_sender"]);
  assert.deepEqual(check({}, { listId: "<members.trade-association.example>" }).signals, ["mailing_list"]);
  assert.deepEqual(check({}, { precedence: "bulk" }).signals, ["bulk"]);
  assert.deepEqual(check({}, { autoSubmitted: "auto-generated" }).signals, ["auto_generated"]);
  assert.equal(check({}, { autoSubmitted: "no" }).neverReply, false);
  assert.equal(check({ from: "noreen@customer.example" }).neverReply, false);
});

test("a blocked sender is filed as the owner chose, without the AI", () => {
  const result = check({ senderLists: { private: false, blocked: { kind: "domain", folder: "Junk offers" } } });
  assert.deepEqual([result.outcome, result.stop, result.blocked], ["blocked", true, { kind: "domain", folder: "Junk offers" }]);
});

test("a reply in a thread we started is a candidate quote or invoice reply", () => {
  const document = { kind: "document" as const, type: "invoice" as const, id: "inv-1", code: "INV-1042" };
  const result = check({ match: { method: "platform_thread", customerEmails: [], customerName: null, document } });
  assert.deepEqual([result.outcome, result.candidateKind, result.document], ["platform_thread", "invoice_reply", document]);
});

test("promotion signals make a candidate, never for a saved customer's own email", () => {
  const promo = check({}, { gmailCategory: "promotions", listUnsubscribe: true });
  assert.deepEqual([promo.outcome, promo.candidateKind, promo.promotionSignals], ["none", "promotion", ["gmail_promotions", "list_unsubscribe"]]);
  assert.deepEqual(check({}, { outlookFocused: false }).promotionSignals, ["outlook_other"]);
  const customer = check({ senderIsCustomer: true }, { gmailCategory: "promotions", listUnsubscribe: true });
  assert.deepEqual([customer.outcome, customer.candidateKind, customer.promotionSignals], ["customer", null, []]);
  // A customer only in Cc links the email, but the sender's newsletter is still a promotion.
  const cc = check({ match: { method: "customer", customerEmails: ["priya@customer.example"], customerName: "Priya", document: null } }, { listUnsubscribe: true });
  assert.deepEqual([cc.outcome, cc.candidateKind], ["customer", "promotion"]);
});

// ---- Private and blocked sender lists (§16) ----------------------------------------------

test("sender values: addresses, domains and masks", () => {
  assert.deepEqual(parseSenderValue(" Wife@Gmail.com "), { kind: "address", value: "wife@gmail.com" });
  assert.deepEqual(parseSenderValue("@Spam.Example"), { kind: "domain", value: "@spam.example" });
  assert.deepEqual(parseSenderValue("spam.example"), { kind: "domain", value: "@spam.example" });
  assert.equal(parseSenderValue("not an address"), null);
  assert.equal(parseSenderValue(42), null);
  assert.equal(maskSender("jane@gmail.com"), "ja***@gmail.com");
  assert.equal(maskSender("jo@gmail.com"), "j***@gmail.com");
  assert.equal(maskSender("@spam.example"), "@spam.example");
});

test("lists are stored hashed per business, with a masked address and the owner's label", async () => {
  const { db, table } = fakeFirestore();
  const added = await addSender(db, "business-a", { list: "private", value: "Wife@Gmail.com", label: " Wife " }, "owner-a", ENABLED_AT);
  assert.ok(added.ok);
  const key = senderKey("business-a", "wife@gmail.com");
  assert.equal(added.entry.key, key);
  const row = table("ai_email_private_senders").get(key);
  assert.equal(row?.display, "wi***@gmail.com");
  assert.equal(row?.label, "Wife");
  assert.ok(!JSON.stringify(row).includes("wife@gmail.com"), "the full address is never stored");
  assert.notEqual(senderKey("business-b", "wife@gmail.com"), key);

  // Adding again updates the label and keeps the date it was first added.
  await addSender(db, "business-a", { list: "private", value: "wife@gmail.com", label: "Partner" }, "owner-a", ENABLED_AT + DAY);
  const [entry] = (await listSenders(db, "business-a")).private;
  assert.deepEqual([entry.label, entry.addedAt], ["Partner", ENABLED_AT]);
});

test("adding refuses domains on the private list, shared mail domains and bad folder names", async () => {
  const { db } = fakeFirestore();
  const refused = async (input: Parameters<typeof addSender>[2]) => {
    const result = await addSender(db, "business-a", input, "owner-a");
    assert.equal(result.ok, false);
  };
  await refused({ list: "private", value: "@family.example" });
  await refused({ list: "blocked", value: "@gmail.com" });
  await refused({ list: "blocked", value: "x@spam.example", folder: "../../etc" });
  await refused({ list: "blocked", value: "nonsense" });
  const blocked = await addSender(db, "business-a", { list: "blocked", value: "@spam.example" }, "owner-a");
  assert.ok(blocked.ok && blocked.entry.folder === "Blocked");
});

test("lookups: private, blocked address over blocked domain, and never another business's list", async () => {
  const { db } = fakeFirestore();
  await addSender(db, "business-a", { list: "private", value: "wife@gmail.com" }, "owner-a");
  await addSender(db, "business-a", { list: "blocked", value: "@spam.example", folder: "Spam offers" }, "owner-a");
  await addSender(db, "business-a", { list: "blocked", value: "boss@spam.example", folder: "Watch" }, "owner-a");

  assert.deepEqual(await lookupSender(db, "business-a", "Wife@gmail.com"), { private: true, blocked: null });
  assert.deepEqual(await lookupSender(db, "business-a", "sales@spam.example"), { private: false, blocked: { kind: "domain", folder: "Spam offers" } });
  assert.deepEqual(await lookupSender(db, "business-a", "boss@spam.example"), { private: false, blocked: { kind: "address", folder: "Watch" } });
  assert.deepEqual(await lookupSender(db, "business-b", "wife@gmail.com"), { private: false, blocked: null });
  assert.deepEqual(await lookupSender(db, "business-a", "not an address"), { private: false, blocked: null });
});

test("removing checks the business and the key", async () => {
  const { db } = fakeFirestore();
  const added = await addSender(db, "business-a", { list: "private", value: "wife@gmail.com" }, "owner-a");
  assert.ok(added.ok);
  assert.equal(await removeSender(db, "business-b", "private", added.entry.key), false);
  assert.equal(await removeSender(db, "business-a", "private", "../other"), false);
  assert.equal(await removeSender(db, "business-a", "blocked", added.entry.key), false);
  assert.equal(await removeSender(db, "business-a", "private", added.entry.key), true);
  assert.equal((await lookupSender(db, "business-a", "wife@gmail.com")).private, false);
});

test("each list holds at most 200 senders", async () => {
  const { db } = fakeFirestore();
  for (let i = 0; i < MAX_SENDERS_PER_LIST; i++) {
    assert.ok((await addSender(db, "business-a", { list: "blocked", value: `s${i}@spam.example` }, "owner-a", ENABLED_AT + i)).ok);
  }
  const full = await addSender(db, "business-a", { list: "blocked", value: "one-more@spam.example" }, "owner-a");
  assert.equal(full.ok, false);
  // Updating someone already on the list still works.
  assert.ok((await addSender(db, "business-a", { list: "blocked", value: "s0@spam.example", label: "x" }, "owner-a")).ok);
  const { blocked } = await listSenders(db, "business-a");
  assert.equal(blocked.length, MAX_SENDERS_PER_LIST);
  // Newest first.
  assert.equal(blocked[0].key, senderKey("business-a", `s${MAX_SENDERS_PER_LIST - 1}@spam.example`));
});
