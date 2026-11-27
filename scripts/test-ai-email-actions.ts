import assert from "node:assert/strict";
import test from "node:test";

import { Timestamp } from "firebase-admin/firestore";

import { overallStatus, runDecisionActions, undoDecisionAction } from "../lib/ai/email/actions";
import type { ActionDeps, ActionMailbox } from "../lib/ai/email/actions/context";
import { createInspection, emailRequestId } from "../lib/ai/email/actions/customers";
import { daysBefore, parseWrittenDate } from "../lib/ai/email/dates";
import { decideCard } from "../lib/ai/email/decisions";
import { detailsPrefill, needsDetails, parseCardDetails } from "../lib/ai/email/details";
import type { EmailAction, EmailTriageResult } from "../lib/ai/email/types";
import { buildCustomerContext, recordsForIntent } from "../lib/email-integration/mailbox/customer-context";
import { gmailMailbox } from "../lib/email-integration/mailbox/gmail";
import { microsoftMailbox } from "../lib/email-integration/mailbox/microsoft";
import { fakeFirestore, type Row } from "./fake-firestore";

const NOW = Date.UTC(2026, 10, 26, 1, 0); // 12 pm, 26 Nov 2026 in Melbourne
const MEL = "Australia/Melbourne";
const TRIAGE_ID = "a".repeat(40);
const ON = { AI_AGENT_ENABLED: "true", AI_AGENT_DRY_RUN: "false" };

// ---- Dates written in email ---------------------------------------------------------------

test("dates written in an email, day first, with the year worked out", () => {
  const read = (text: string) => parseWrittenDate(text, NOW, MEL);
  assert.equal(read("Due 3 Dec"), "2026-12-03");
  assert.equal(read("due 3rd December 2026"), "2026-12-03");
  assert.equal(read("Dec 3, 2026"), "2026-12-03");
  assert.equal(read("03/12/2026"), "2026-12-03");
  assert.equal(read("3/12"), "2026-12-03");
  assert.equal(read("2026-12-03"), "2026-12-03");
  assert.equal(read("12 items, due 3 Dec"), "2026-12-03");
  assert.equal(read("payment due 5 Jan"), "2027-01-05", "January after a November email is next year");
  assert.equal(read("renew by 3 September"), "2027-09-03");
  assert.equal(read("1 Nov"), "2026-11-01", "a few weeks ago is still this year");
  assert.equal(read("a decent 5 stars"), null);
  assert.equal(read("31/02/2026"), null);
  assert.equal(read(""), null);
  assert.equal(read("next Tuesday"), null, "Sophie never guesses a date");
  assert.equal(daysBefore("2027-01-01", 7), "2026-12-25");
});

// ---- The runner ---------------------------------------------------------------------------

const RESULT: EmailTriageResult = {
  kind: "supplier_bill", confidence: 0.9, summary: "Invoice INV-88213 from Acme.", urgency: "routine",
  customerIntent: null, complaintType: null, friendlyType: null, jobRef: null,
  extracted: { supplierName: "Acme Supplies", billAmount: "$842.40", billDueDate: "due 3 Dec", billReference: "INV-88213" },
  flags: [],
};

function setup(options: { actions: EmailAction[]; triage?: Row; message?: Row | null; env?: Record<string, string>; paused?: boolean; decision?: Row }) {
  const { db, table } = fakeFirestore();
  table("ai_email_triage").set(TRIAGE_ID, {
    businessId: "business-a", messageId: "conn-a_m1", status: "owner_done", identity: "verified_sender",
    customerName: "Priya Shah", sender: { name: "Acme Accounts", address: "accounts@acme.example" },
    subject: "Invoice INV-88213", result: RESULT, ...options.triage,
  });
  if (options.message !== null) {
    table("email_messages").set("conn-a_m1", {
      businessId: "business-a", connectionId: "conn-a", providerMessageId: "m1", threadId: "t1", folder: "inbox",
      unread: true, messageIdHeader: "<m1@acme.example>", matchMethod: "none", customerEmails: [], linked: false,
      sentAt: Timestamp.fromMillis(NOW - 3_600_000), ...options.message,
    });
  }
  table("ai_email_decisions").set(TRIAGE_ID, {
    businessId: "business-a", triageId: TRIAGE_ID, messageId: "conn-a_m1", confirmedKind: "supplier_bill",
    actions: options.actions, actionsStatus: "pending", decidedBy: "owner-a", decidedAt: Timestamp.fromMillis(NOW),
    ...options.decision,
  });
  if (options.paused) table("ai_email_settings").set("business-a", { enabled: true, enabledAt: Timestamp.fromMillis(NOW - 86_400_000), paused: true });

  const calls = {
    moved: [] as string[][], restored: 0, read: [] as boolean[], refreshed: 0, pushes: [] as { title: string; body: string }[], retired: [] as string[],
    ensured: [] as { email: string; fullName: string; phone: string }[], requests: [] as Row[], cancelled: [] as string[],
  };
  const customers = new Map<string, string>();
  const requests = new Map<string, string>();
  const behaviour = { customerMismatch: false, requestMovedOn: false };
  let failRead = 0;
  const mailbox: ActionMailbox = {
    async moveToFolder(ids, folder) { calls.moved.push([...ids, folder]); },
    async restoreToInbox() { calls.restored++; },
    async setRead(_target, read) { if (failRead-- > 0) throw new Error("provider_unavailable"); calls.read.push(read); },
    async refresh() { calls.refreshed++; },
  };
  const deps: ActionDeps = {
    db,
    env: options.env ?? ON,
    mailbox: async () => mailbox,
    pushOwner: async (_businessId, push) => { calls.pushes.push(push); },
    timeZone: async () => MEL,
    dayStart: async () => "07:30",
    businessProfile: async () => ({ name: "Northside Workshop", phone: "(02) 9000 0000", ownerFirstName: "Dan" }),
    staffSchedule: async () => null,
    staffBusy: async () => [], createReturnJob: async () => ({ ok: false, error: "n/a" }),
    complaintJobs: async () => [],
    staffCheckIns: async () => [],
    customerRecords: async () => null,
    businessHours: async () => ({ startTime: "08:00", endTime: "17:00", openDays: [1, 2, 3, 4, 5], closedDates: [] }),
    resendDocument: async () => ({ ok: false, reason: "not_found" }),
    replyMailbox: async () => null,
    retireExample: async (_businessId, id) => { calls.retired.push(id); return true; },
    async ensureCustomer(input) {
      calls.ensured.push(input);
      if (behaviour.customerMismatch) throw new Error("Customer contact details could not be matched.");
      const existing = customers.get(input.email);
      if (existing) return { uid: existing, created: false };
      customers.set(input.email, "cust-1");
      return { uid: "cust-1", created: true };
    },
    findCustomer: async (_businessId, email) => customers.get(email) ?? null,
    async createRequest(input) {
      calls.requests.push(input as unknown as Row);
      if (requests.has(input.requestId)) return { ok: true, requestCode: requests.get(input.requestId)!, existing: true };
      requests.set(input.requestId, `INS-REQ ${requests.size + 1}`);
      return { ok: true, requestCode: requests.get(input.requestId)!, existing: false };
    },
    async cancelRequest(input) {
      if (behaviour.requestMovedOn) return { ok: false, reason: "That request has moved on. Change it under Requests." };
      calls.cancelled.push(input.requestId);
      return { ok: true };
    },
  };
  const decision = () => table("ai_email_decisions").get(TRIAGE_ID) as Row & { results: Record<string, { status: string; summary: string }> };
  return {
    db, table, deps, calls, decision, behaviour, requests,
    failReadOnce: () => { failRead = 1; },
    run: () => runDecisionActions(deps, TRIAGE_ID, NOW),
  };
}

test("a promotion is moved to Advertising and marked read, with an audit row for each", async () => {
  const s = setup({ actions: [{ kind: "move_folder", folder: "Advertising" }, { kind: "mark_read" }] });
  assert.equal(await s.run(), "actions:done");
  assert.deepEqual(s.calls.moved, [["m1", "Advertising"]]);
  assert.deepEqual(s.calls.read, [true]);
  assert.equal(s.decision().actionsStatus, "done");
  assert.deepEqual(Object.values(s.decision().results).map((result) => result.status), ["done", "done"]);
  const audit = [...s.table("ai_agent_actions").values()];
  assert.deepEqual(audit.map((row) => [row.action, row.status]).sort(), [["mark_read", "done"], ["move_folder", "done"]]);
  assert.equal(await s.run(), "nothing_to_run", "a finished decision never runs again");
});

test("T19: a bill is added with the amount as written, and nothing is paid or recorded in the books", async () => {
  const s = setup({ actions: [{ kind: "add_bill_item" }] });
  await s.run();
  const bill = s.table("email_bill_items").get(TRIAGE_ID);
  assert.deepEqual([bill?.amountAsWritten, bill?.dueDate, bill?.supplierName, bill?.reference, bill?.status], ["$842.40", "2026-12-03", "Acme Supplies", "INV-88213", "to_review"]);
  const event = s.table("calendar_personal_events").get(`sophie_bill_${TRIAGE_ID}`);
  assert.deepEqual([event?.date, event?.startTime, event?.endTime, event?.createdBy], ["2026-12-03", "07:30", "08:00", "sophie"]);
  assert.ok(!String(event?.title).includes("842") && !String(event?.notes).includes("842"), "staff can see the calendar: no amounts on it");
  assert.equal(s.table("invoices").size + s.table("payments").size, 0);
  assert.match(s.decision().results.add_bill_item.summary, /\$842\.40 as written, not checked/);
});

test("T10: an email changing bank details never becomes a bill", async () => {
  const s = setup({ actions: [{ kind: "add_bill_item" }], triage: { result: { ...RESULT, kind: "suspicious", flags: ["bank_change"] } } });
  await s.run();
  assert.equal(s.table("email_bill_items").size, 0);
  assert.equal(s.decision().results.add_bill_item.status, "skipped");
});

test("T06: a run that dies part-way is retried without doing anything twice", async () => {
  const s = setup({ actions: [{ kind: "add_bill_item" }, { kind: "mark_read" }] });
  s.failReadOnce();
  await assert.rejects(s.run());
  assert.deepEqual([s.decision().results.add_bill_item.status, s.decision().results.mark_read.status], ["done", "failed"]);
  assert.equal(s.decision().actionsStatus, "pending");
  const billCreatedAt = s.table("email_bill_items").get(TRIAGE_ID)?.createdAt;

  assert.equal(await s.run(), "actions:done");
  assert.equal(s.table("email_bill_items").size, 1);
  assert.equal(s.table("calendar_personal_events").size, 1);
  assert.equal(s.table("email_bill_items").get(TRIAGE_ID)?.createdAt, billCreatedAt, "the bill wasn't made again");
  assert.deepEqual(s.calls.read, [true]);
});

test("T09: “I've paid” pauses that invoice's reminders, tells the owner, and never marks it paid", async () => {
  const s = setup({
    actions: [{ kind: "pause_reminders", reason: "payment_claim" }],
    message: { platformDocument: { kind: "document", type: "invoice", id: "inv-1", code: "INV-1042" } },
  });
  s.table("invoices").set("inv-1", { businessId: "business-a", status: "sent", invoiceCode: "INV-1042" });
  await s.run();
  const invoice = s.table("invoices").get("inv-1");
  assert.equal(invoice?.status, "sent");
  assert.deepEqual([(invoice?.remindersPause as Row)?.reason, (invoice?.remindersPause as Row)?.triageId], ["payment_claim", TRIAGE_ID]);
  assert.deepEqual(s.calls.pushes.map((push) => push.title), ["Customer says INV-1042 is paid"]);

  assert.deepEqual(await undoDecisionAction(s.deps, { businessId: "business-a", triageId: TRIAGE_ID, kind: "pause_reminders", actorUid: "owner-a" }, NOW),
    { ok: true, summary: "Turned the invoice reminders back on." });
  assert.equal(s.table("invoices").get("inv-1")?.remindersPause, undefined);
});

test("reminders: an invoice that isn't found, is paid, or belongs to someone else is never touched", async () => {
  const noInvoice = setup({ actions: [{ kind: "pause_reminders", reason: "payment_claim" }] });
  await noInvoice.run();
  assert.equal(noInvoice.decision().results.pause_reminders.status, "needs_details");

  const paid = setup({ actions: [{ kind: "pause_reminders", reason: "payment_claim" }], message: { platformDocument: { type: "invoice", id: "inv-1", code: "INV-1" } } });
  paid.table("invoices").set("inv-1", { businessId: "business-a", status: "paid" });
  await paid.run();
  assert.deepEqual([paid.decision().results.pause_reminders.status, paid.table("invoices").get("inv-1")?.remindersPause], ["skipped", undefined]);

  const foreign = setup({ actions: [{ kind: "pause_reminders", reason: "payment_claim" }], message: { platformDocument: { type: "invoice", id: "inv-1", code: "INV-1" } } });
  foreign.table("invoices").set("inv-1", { businessId: "business-b", status: "sent" });
  await foreign.run();
  assert.deepEqual([foreign.decision().results.pause_reminders.status, foreign.table("invoices").get("inv-1")?.remindersPause], ["needs_details", undefined]);
});

test("Pause stops every action, and dry run changes nothing", async () => {
  const paused = setup({ actions: [{ kind: "move_folder", folder: "Advertising" }, { kind: "add_bill_item" }], paused: true });
  assert.equal(await paused.run(), "actions:blocked");
  assert.deepEqual([paused.calls.moved, paused.table("email_bill_items").size], [[], 0]);
  assert.match(paused.decision().results.move_folder.summary, /paused/);

  const dry = setup({ actions: [{ kind: "move_folder", folder: "Advertising" }], env: { AI_AGENT_ENABLED: "true" } });
  assert.equal(await dry.run(), "actions:dry_run");
  assert.deepEqual(dry.calls.moved, []);
  assert.equal([...dry.table("ai_agent_actions").values()][0].status, "dry_run");
});

test("Sophie asks for what she can't find instead of guessing", async () => {
  const s = setup({
    actions: [{ kind: "add_bill_item" }, { kind: "add_calendar_reminder", daysBefore: 7 }, { kind: "save_customer" }, { kind: "notify_owner", urgency: "today" }],
    triage: { result: { ...RESULT, extracted: { supplierName: "Acme" } } },
  });
  assert.equal(await s.run(), "actions:partial");
  const results = s.decision().results;
  assert.deepEqual(
    [results.add_bill_item.status, results.add_calendar_reminder.status, results.save_customer.status, results.notify_owner.status],
    ["needs_details", "needs_details", "needs_details", "skipped"],
  );
  assert.deepEqual(s.calls.ensured, [], "no customer without the owner's confirmed details");
  assert.deepEqual(s.calls.pushes, [], "the owner already saw the card: no push");
});

test("a calendar reminder a week before the date in the email, and its undo", async () => {
  const s = setup({ actions: [{ kind: "add_calendar_reminder", daysBefore: 7 }], triage: { subject: "Permit renewal", result: { ...RESULT, extracted: { importantDate: "renew by 15 Jan 2027" } } } });
  await s.run();
  const event = s.table("calendar_personal_events").get(`sophie_reminder_${TRIAGE_ID}`);
  assert.deepEqual([event?.date, event?.title], ["2027-01-08", "Reminder: Permit renewal"]);
  await undoDecisionAction(s.deps, { businessId: "business-a", triageId: TRIAGE_ID, kind: "add_calendar_reminder", actorUid: "owner-a" }, NOW);
  assert.equal(s.table("calendar_personal_events").size, 0);

  const past = setup({ actions: [{ kind: "add_calendar_reminder", daysBefore: 7 }], triage: { result: { ...RESULT, extracted: { importantDate: "2026-11-01" } } } });
  await past.run();
  assert.equal(past.decision().results.add_calendar_reminder.status, "skipped");
});

test("linking the email to the customer, only from the sender's own verified address, and its undo", async () => {
  const s = setup({ actions: [{ kind: "link_thread" }], triage: { sender: { name: "Priya", address: "priya@customer.example" } } });
  await s.run();
  const message = s.table("email_messages").get("conn-a_m1");
  assert.deepEqual([message?.linked, message?.customerEmails, message?.customerName], [true, ["priya@customer.example"], "Priya Shah"]);
  await undoDecisionAction(s.deps, { businessId: "business-a", triageId: TRIAGE_ID, kind: "link_thread", actorUid: "owner-a" }, NOW);
  assert.deepEqual([s.table("email_messages").get("conn-a_m1")?.linked, s.table("email_messages").get("conn-a_m1")?.customerEmails], [false, []]);

  const stranger = setup({ actions: [{ kind: "link_thread" }], triage: { identity: "none" } });
  await stranger.run();
  assert.equal(stranger.decision().results.link_thread.status, "skipped");
});

test("Undo: once, only for this business, only for what can be undone, and Sophie forgets the example", async () => {
  const s = setup({ actions: [{ kind: "move_folder", folder: "Advertising" }, { kind: "ignore" }] });
  await s.run();
  const undo = (kind: string, businessId = "business-a") => undoDecisionAction(s.deps, { businessId, triageId: TRIAGE_ID, kind, actorUid: "owner-a" }, NOW);
  assert.deepEqual(await undo("move_folder", "business-b"), { ok: false, status: 404, error: "Action not found." });
  assert.deepEqual(await undo("ignore"), { ok: false, status: 409, error: "This one can't be undone." });
  assert.deepEqual(await undo("forward_everything"), { ok: false, status: 404, error: "Action not found." });
  assert.deepEqual(await undo("move_folder"), { ok: true, summary: "Moved it back to the Inbox." });
  assert.equal(s.calls.restored, 1);
  assert.equal(s.decision().results.move_folder.status, "undone");
  assert.deepEqual(s.calls.retired, [TRIAGE_ID]);
  assert.deepEqual(await undo("move_folder"), { ok: false, status: 409, error: "There's nothing to undo." });
  assert.ok([...s.table("ai_agent_actions").values()].some((row) => row.action === "undo_move_folder"));
});

test("when the email is gone, nothing is done to it", async () => {
  const s = setup({ actions: [{ kind: "mark_read" }, { kind: "ignore" }], message: null });
  await s.run();
  assert.deepEqual([s.decision().results.mark_read.status, s.decision().results.ignore.status], ["blocked", "done"]);
  assert.deepEqual(s.calls.read, []);
});

test("overall status", () => {
  const actions: EmailAction[] = [{ kind: "mark_read" }, { kind: "ignore" }];
  const r = (status: string) => ({ status, summary: "", undo: null, at: 0 }) as never;
  assert.equal(overallStatus(actions, { mark_read: r("done"), ignore: r("skipped") }), "done");
  assert.equal(overallStatus(actions, { mark_read: r("dry_run"), ignore: r("dry_run") }), "dry_run");
  assert.equal(overallStatus(actions, { mark_read: r("blocked"), ignore: r("blocked") }), "blocked");
  assert.equal(overallStatus(actions, { mark_read: r("done"), ignore: r("needs_details") }), "partial");
});

// ---- Folders at the providers ---------------------------------------------------------------

const credentials = { accessToken: "token", accessTokenExpiresAt: Date.now() + 3_600_000, refreshToken: "refresh" };

test("Gmail: the label is created once if missing, then the message leaves the Inbox; undo puts it back", async (t) => {
  const requests: { method: string; path: string; body: unknown }[] = [];
  let labels = [{ id: "Label_1", name: "Council" }];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace("/gmail/v1/users/me", "");
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ method: init?.method ?? "GET", path, body });
    if (path === "/labels" && init?.method === "POST") {
      labels = [...labels, { id: "Label_2", name: body.name }];
      return Response.json({ id: "Label_2", name: body.name });
    }
    if (path === "/labels") return Response.json({ labels });
    return Response.json({ id: "m1" });
  });
  await gmailMailbox.moveToFolder(credentials, ["m1"], "Advertising");
  assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), ["GET /labels", "POST /labels", "POST /messages/m1/modify"]);
  assert.deepEqual(requests[2].body, { addLabelIds: ["Label_2"], removeLabelIds: ["INBOX"] });

  requests.length = 0;
  await gmailMailbox.moveToFolder(credentials, ["m2"], "advertising");
  assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), ["GET /labels", "POST /messages/m2/modify"], "found in any case, not made twice");

  requests.length = 0;
  await gmailMailbox.restoreToInbox(credentials, [{ id: "m1", messageIdHeader: "" }], "Advertising");
  assert.deepEqual(requests.at(-1)?.body, { addLabelIds: ["INBOX"], removeLabelIds: ["Label_2"] });
});

test("Outlook: the folder is created once if missing, then the message moves; undo moves it back", async (t) => {
  const requests: string[] = [];
  let folders: { id: string }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    const text = decodeURIComponent(String(url));
    requests.push(`${init?.method ?? "GET"} ${text.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "")}`);
    if (text.includes("/me/mailFolders?") ) return Response.json({ value: folders });
    if (text.endsWith("/me/mailFolders")) { folders = [{ id: "folder-1" }]; return Response.json({ id: "folder-1" }, { status: 201 }); }
    return Response.json({ id: "m1" }, { status: 201 });
  });
  await microsoftMailbox.moveToFolder(credentials, ["m1"], "Owner's mail");
  assert.equal(requests[0], "GET /me/mailFolders?$filter=displayName eq 'Owner''s mail'&$select=id");
  assert.deepEqual(requests.slice(1), ["POST /me/mailFolders", "POST /me/messages/m1/move"]);
  requests.length = 0;
  await microsoftMailbox.restoreToInbox(credentials, [{ id: "m1", messageIdHeader: "" }], "Owner's mail");
  assert.deepEqual(requests, ["POST /me/messages/m1/move"]);
});

// ---- Step 6b: customers and requests, from details the owner confirmed -------------------------

const CONFIRMED = {
  fullName: "Priya Shah", phone: "0412 345 678",
  address: { street: "12 Smith St", suburb: "Ryde", state: "NSW", postcode: "2112" },
  // The platform's own check compares dates with the real clock: a week from today.
  preferredSlots: [{ date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), timeRange: "morning" as const }],
  title: "Gate intercom not working", description: "Stopped working on Monday.",
};

test("the owner's details: name and phone always, and a request also needs the work and a date", () => {
  const check = (raw: unknown, kinds: Parameters<typeof parseCardDetails>[1]["kinds"]) =>
    parseCardDetails(raw, { kinds, email: "priya@customer.example", timeZone: MEL });
  assert.deepEqual(check(null, ["save_customer"]), { ok: false, error: "Check the customer's details first." });
  assert.deepEqual(check({ ...CONFIRMED, fullName: " " }, ["save_customer"]), { ok: false, error: "Add the customer's name." });
  assert.deepEqual(check({ ...CONFIRMED, phone: "12" }, ["save_customer"]), { ok: false, error: "Add the customer's phone number." });
  const customerOnly = check(CONFIRMED, ["save_customer"]);
  assert.ok(customerOnly.ok && customerOnly.requestInput === null);

  assert.equal(check({ ...CONFIRMED, preferredSlots: [] }, ["create_inspection"]).ok, false);
  assert.equal(check({ ...CONFIRMED, preferredSlots: [{ date: "2020-01-01", timeRange: "morning" }] }, ["create_inspection"]).ok, false, "no dates in the past");
  assert.equal(check({ ...CONFIRMED, title: "" }, ["create_job_request"]).ok, false);
  const request = check({ ...CONFIRMED, address: { street: "", suburb: "", state: "", postcode: "" } }, ["create_inspection"]);
  assert.ok(request.ok && request.requestInput, "the site address is optional, as for the owner's own requests");
  assert.deepEqual([request.requestInput.requestType, request.requestInput.customer.email, request.requestInput.customer.phone],
    ["custom_quote", "priya@customer.example", "0412345678"]);
  assert.equal(needsDetails(["move_folder", "mark_read"]), false);
  assert.equal(needsDetails(["save_customer"]), true);
});

test("the form starts with the sender and what the AI read, and the owner checks it", () => {
  const prefill = detailsPrefill({
    sender: { name: "P Shah", address: "priya@customer.example" },
    subject: "Intercom",
    result: { ...RESULT, kind: "inspection_request", summary: "Gate intercom stopped.", extracted: { customerName: "Priya Shah", phone: "0412 345 678", suburb: "Ryde", service: "Intercom repair", preferredTimes: ["Tuesday morning"] } },
  });
  assert.deepEqual([prefill.email, prefill.fullName, prefill.phone, prefill.address.suburb, prefill.title, prefill.askedFor, prefill.preferredSlots],
    ["priya@customer.example", "Priya Shah", "0412 345 678", "Ryde", "Intercom repair", ["Tuesday morning"], []]);
});

test("a decision that will really run needs the details; a practice one doesn't", async () => {
  const { db, table } = fakeFirestore();
  const triageRow = (shadow: boolean) => ({
    businessId: "business-a", messageId: "conn-a_m1", status: "new", precheck: "none", shadow,
    sender: { name: "Priya", address: "priya@customer.example" }, result: { ...RESULT, kind: "inspection_request" },
  });
  table("ai_email_triage").set(TRIAGE_ID, triageRow(false));
  const decide = (details?: unknown, triageId = TRIAGE_ID) => decideCard(db, {
    businessId: "business-a", triageId, actorUid: "owner-a", via: "app", choice: { choice: "confirm" },
    kinds: new Set(["inspection_request"]), details, timeZone: MEL,
  }, NOW);
  assert.deepEqual(await decide(), { ok: false, status: 400, error: "Check the customer's details first." });
  assert.deepEqual(await decide({ ...CONFIRMED, preferredSlots: [] }), { ok: false, status: 400, error: "Pick at least one preferred date and time range." });
  const saved = await decide(CONFIRMED);
  assert.ok(saved.ok);
  const decision = table("ai_email_decisions").get(TRIAGE_ID);
  assert.deepEqual([(decision?.details as Row)?.fullName, (decision?.requestInput as Row)?.requestType, decision?.actionsStatus], ["Priya Shah", "custom_quote", "pending"]);

  const practice = "b".repeat(40);
  table("ai_email_triage").set(practice, triageRow(true));
  const shadow = await decide(undefined, practice);
  assert.ok(shadow.ok && shadow.decision.actionsStatus === "not_run" && shadow.decision.details === undefined);
});

const REQUEST_INPUT = (() => {
  const parsed = parseCardDetails(CONFIRMED, { kinds: ["create_inspection"], email: "priya@customer.example", timeZone: MEL });
  if (!parsed.ok || !parsed.requestInput) throw new Error("fixture");
  return parsed.requestInput;
})();

function requestSetup(actions: EmailAction[] = [{ kind: "save_customer" }, { kind: "create_inspection" }]) {
  return setup({
    actions,
    triage: { sender: { name: "Priya", address: "priya@customer.example" }, result: { ...RESULT, kind: "inspection_request" } },
    decision: { details: CONFIRMED, requestInput: REQUEST_INPUT },
  });
}

test("an inspection request: the customer is saved, then a pending request is added for them", async () => {
  const s = requestSetup();
  assert.equal(await s.run(), "actions:done");
  assert.deepEqual(s.calls.ensured.map((call) => [call.email, call.fullName, call.phone]), [["priya@customer.example", "Priya Shah", "0412 345 678"]]);
  assert.equal(s.calls.requests.length, 1);
  const added = s.calls.requests[0];
  assert.deepEqual([added.requestId, added.customerId, added.kind, added.triageId], [emailRequestId(TRIAGE_ID, "inspection_request"), "cust-1", "inspection_request", TRIAGE_ID]);
  assert.match(s.decision().results.save_customer.summary, /No welcome email/);
  assert.match(s.decision().results.create_inspection.summary, /INS-REQ 1\. It's pending/);
});

test("T06: an inspection request under a retried run is added once", async () => {
  const s = requestSetup([{ kind: "save_customer" }, { kind: "create_inspection" }, { kind: "mark_read" }]);
  s.failReadOnce();
  await assert.rejects(s.run());
  // The run died after adding the request. The retry neither saves the customer nor adds the request again.
  assert.equal(await s.run(), "actions:done");
  assert.deepEqual([s.calls.ensured.length, s.calls.requests.length, s.requests.size], [1, 1, 1]);
  // And even if the request's own result had been lost, the fixed id finds the one already added.
  const again = await createInspection.run({
    deps: s.deps, businessId: "business-a", triageId: TRIAGE_ID, triage: {}, message: null, authority: "owner",
    actorUid: "owner-a", decision: { requestInput: REQUEST_INPUT }, action: { kind: "create_inspection" }, now: NOW,
  });
  assert.equal(again.status, "done");
  assert.equal(s.requests.size, 1);
});

test("a job request is its own pending request, under its own id", async () => {
  const s = requestSetup([{ kind: "create_job_request" }]);
  await s.run();
  assert.equal(s.calls.requests[0].requestId, emailRequestId(TRIAGE_ID, "job_request"));
  assert.notEqual(emailRequestId(TRIAGE_ID, "job_request"), emailRequestId(TRIAGE_ID, "inspection_request"));
  assert.match(s.decision().results.create_job_request.summary, /Added job request/);
});

test("an address that's already a customer with other details is never changed", async () => {
  const s = requestSetup([{ kind: "save_customer" }]);
  s.behaviour.customerMismatch = true;
  await s.run();
  assert.equal(s.decision().results.save_customer.status, "needs_details");
  assert.match(s.decision().results.save_customer.summary, /already a customer with different details/);
});

test("undoing a request cancels it while it's pending, and never once it has moved on", async () => {
  const s = requestSetup([{ kind: "create_inspection" }]);
  await s.run();
  const undo = () => undoDecisionAction(s.deps, { businessId: "business-a", triageId: TRIAGE_ID, kind: "create_inspection", actorUid: "owner-a" }, NOW);
  s.behaviour.requestMovedOn = true;
  assert.deepEqual(await undo(), { ok: false, status: 502, error: "That request has moved on. Change it under Requests." });
  assert.equal(s.decision().results.create_inspection.status, "done", "still done, so it can be tried again");
  s.behaviour.requestMovedOn = false;
  assert.deepEqual(await undo(), { ok: true, summary: "Cancelled the site inspection request INS-REQ 1." });
  assert.deepEqual(s.calls.cancelled, [emailRequestId(TRIAGE_ID, "inspection_request")]);
  // A saved customer is a real account: there's no Undo for it.
  const customer = requestSetup([{ kind: "save_customer" }]);
  await customer.run();
  assert.deepEqual(await undoDecisionAction(customer.deps, { businessId: "business-a", triageId: TRIAGE_ID, kind: "save_customer", actorUid: "owner-a" }, NOW),
    { ok: false, status: 409, error: "This one can't be undone." });
});

// ---- The customer context (§9.4) ---------------------------------------------------------------

const CONTEXT = buildCustomerContext("priya@customer.example", new Set(["Priya Shah"]), {
  quotes: [{ id: "q1", data: { quotationCode: "Q-311", status: "sent", finalPriceAud: 1200, createdAt: Timestamp.fromMillis(NOW - 5 * 86_400_000) } }],
  invoices: [{ id: "i1", data: { invoiceCode: "INV-1042", status: "sent", balanceDueAud: 842.4, createdAt: Timestamp.fromMillis(NOW - 86_400_000) } }],
  jobs: [
    { id: "j1", data: { bookingCode: "J-1042", status: "scheduled", scheduledAt: Timestamp.fromMillis(NOW + 3 * 86_400_000) } },
    { id: "j2", data: { bookingCode: "J-0991", status: "completed", scheduledAt: Timestamp.fromMillis(NOW - 30 * 86_400_000) } },
  ],
  inspections: [{ id: "r1", data: { requestCode: "INS-REQ 7", status: "pending", createdAt: Timestamp.fromMillis(NOW) } }],
});

test("the shared customer context keeps the panel's view", () => {
  assert.deepEqual([CONTEXT.name, CONTEXT.quotes[0].code, CONTEXT.invoices[0].amountAud, CONTEXT.jobs.map((job) => job.code)],
    ["Priya Shah", "Q-311", 842.4, ["J-1042", "J-0991"]]);
});

test("each question sees only its own fields, and never an amount", () => {
  const status = recordsForIntent(CONTEXT, "booking_status");
  assert.deepEqual(status.records.upcoming.map((item) => item.code), ["INS-REQ 7", "J-1042"]);
  assert.deepEqual(recordsForIntent(CONTEXT, "quote_status").records, { quotes: [{ code: "Q-311", status: "sent", date: NOW - 5 * 86_400_000 }] });
  assert.deepEqual(recordsForIntent(CONTEXT, "document_request").records, { quotes: [{ id: "q1", code: "Q-311" }], invoices: [{ id: "i1", code: "INV-1042" }] });
  assert.deepEqual(recordsForIntent(CONTEXT, "repeat_fault").records, { completedJobs: [{ code: "J-0991", date: NOW - 30 * 86_400_000 }] });
  assert.deepEqual(recordsForIntent(CONTEXT, "booking_cancel").records, {});
  for (const intent of ["booking_status", "quote_status", "document_request", "repeat_fault", "request_status"] as const) {
    const json = JSON.stringify(recordsForIntent(CONTEXT, intent));
    assert.ok(!/\b1200\b|\b842(\.4)?\b|amount/.test(json), intent);
  }
});
