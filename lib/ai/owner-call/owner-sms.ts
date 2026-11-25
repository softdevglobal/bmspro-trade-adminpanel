/**
 * Voice SMS section, browser tools: Sophie reads the SMS balance, reads and searches the SMS log, lists the
 * customers who can get a text, and drives the Custom messages page (write, template, recipients, review,
 * send, cancel). The MCP twins are get_sms_balance, get_sms_log, get_sms_customers and prepare_sms_send
 * (owner-actions.ts); sending then goes through confirm_owner_change.
 *
 *   show_sms_balance      remaining, used, total, plan and the top-up packages (read only; never buys)
 *   list_sms_log          the SMS log with search, status, since and page (the open page follows)
 *   list_sms_customers    customers with a phone number (read only)
 *   open_custom_message   open the Custom messages page
 *   sms_message_step      write, template, recipients, search, select, scroll, review, send, cancel
 *
 * Plan and rules: docs/owner-voice-sms.md. Pure apart from fetch: no server-only imports, so the
 * summaries and the read-back are the same code in the browser and on the MCP route.
 */
import type { BusinessSmsBalance } from "@/lib/sms-packages/balance";
import type { SmsLogEntry } from "@/lib/sms/sms-log-types";
import { ask, blocked, clear, type TeamGate } from "./owner-team-runner";
import { type VoiceResult } from "./owner-team";

/** Feature flag, off unless set. Separate from the other areas so it can be switched off alone. */
export function ownerSmsEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.AI_OWNER_VOICE_SMS_ENABLED === "true";
}

export const SMS_CREDITS_PAGE = "/dashboard/sms";
export const SMS_LOG_PAGE = "/dashboard/sms/log";
export const CUSTOM_MESSAGES_PAGE = "/dashboard/sms/custom-messages";

export const SMS_LIMITS = {
  /** Same as the Custom messages page and POST /api/business/custom-messages, business name included. */
  messageMax: 480,
  logPageSize: 10,
  customersMax: 50,
  /** Voice sends per owner per hour (enforced by the route for requests marked as voice). */
  voiceSendsPerHour: 3,
  /** Up to this many recipients are read back by name; more are read back as a count. */
  namesReadOut: 5,
} as const;

/** Header that marks a custom-message send as coming from Sophie, so the route applies the voice send limit. */
export const SMS_VOICE_HEADER = "x-bms-voice";

export const SHOW_SMS_BALANCE_TOOL = "show_sms_balance";
export const LIST_SMS_LOG_TOOL = "list_sms_log";
export const LIST_SMS_CUSTOMERS_TOOL = "list_sms_customers";
export const OPEN_CUSTOM_MESSAGE_TOOL = "open_custom_message";
export const SMS_MESSAGE_STEP_TOOL = "sms_message_step";
export const OWNER_SMS_TOOL_NAMES = [
  SHOW_SMS_BALANCE_TOOL, LIST_SMS_LOG_TOOL, LIST_SMS_CUSTOMERS_TOOL, OPEN_CUSTOM_MESSAGE_TOOL, SMS_MESSAGE_STEP_TOOL,
] as const;
export type OwnerSmsToolName = (typeof OWNER_SMS_TOOL_NAMES)[number];
export const isOwnerSmsTool = (name: string): name is OwnerSmsToolName => (OWNER_SMS_TOOL_NAMES as readonly string[]).includes(name);

export const SMS_MESSAGE_ACTIONS = [
  "write", "template", "recipients_all", "recipients_select", "search", "select_all_shown", "clear_selection",
  "scroll_down", "scroll_up", "review", "send", "cancel",
] as const;
export type SmsMessageAction = (typeof SMS_MESSAGE_ACTIONS)[number];
/** Actions that change what would be sent: after a read-back they cancel the owner's yes. */
export const SMS_CHANGING_ACTIONS: readonly SmsMessageAction[] = [
  "write", "template", "recipients_all", "recipients_select", "select_all_shown", "clear_selection",
];
export const SMS_LOG_STATUSES = ["sent", "failed", "skipped"] as const;

/** The quick templates on the Custom messages page (the page renders these chips). */
export const SMS_TEMPLATES = {
  seasons_greetings: {
    label: "Season's greetings",
    text: "Season's greetings from our team! Thank you for your support this year. We wish you a safe and happy holiday season.",
  },
  merry_christmas: {
    label: "Merry Christmas",
    text: "Merry Christmas from all of us! We appreciate your business and look forward to working with you again soon.",
  },
  happy_new_year: {
    label: "Happy New Year",
    text: "Happy New Year! Thank you for trusting us this year. Wishing you health and happiness in the year ahead.",
  },
} as const;
export type SmsTemplateId = keyof typeof SMS_TEMPLATES;
export const SMS_TEMPLATE_IDS = Object.keys(SMS_TEMPLATES) as SmsTemplateId[];

export type SmsMessageArgs = {
  action: SmsMessageAction;
  message?: string;
  template?: SmsTemplateId;
  add?: string[];
  remove?: string[];
  query?: string;
};

// ---- Pure helpers (shared with the MCP tools and the page) ---------------------------------------

/** The SMS body customers receive: the business name in front, like POST /api/business/custom-messages. */
export function previewOutboundMessage(message: string, businessName: string | null | undefined): string {
  const trimmed = message.trim();
  const name = businessName?.trim() || null;
  if (!trimmed || !name) return trimmed;
  if (trimmed.toLowerCase().startsWith(`${name.toLowerCase()}:`)) return trimmed;
  return `${name}: ${trimmed}`;
}

/** The last 3 digits, so the owner can tell two customers apart without the number being read out. */
export const phoneEnding = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-3);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Balance as Sophie reads it, plus the top-up packages (read only: the owner buys them on the page). */
export function summarizeSmsBalance(
  balance: BusinessSmsBalance | null,
  packages: { name: string; messageQuota: number; priceLabel?: string; price?: number }[] = [],
): VoiceResult {
  if (!balance) return { status: "UNAVAILABLE", message: "Could not load the SMS balance." };
  const topUps = packages.map((item) => ({
    name: item.name, messages: item.messageQuota,
    price: item.priceLabel || (typeof item.price === "number" ? `$${item.price.toFixed(2)}` : null),
  }));
  if (balance.isUnlimited) {
    return { status: "OK", unlimited: true, used: balance.used, plan: balance.smsPackageName, topUps,
      message: "The business has unlimited SMS. Say how many were used if asked." };
  }
  return {
    status: "OK", unlimited: false, remaining: balance.remaining ?? 0, used: balance.used, total: balance.limit,
    plan: balance.smsPackageName, low: balance.isLow, topUps,
    message: `Say: ${balance.remaining ?? 0} SMS left, ${balance.used} used of ${balance.limit}.` +
      (balance.isLow ? " The balance is low: suggest a top-up." : "") +
      " You cannot buy a top-up: the owner presses Top up package on the SMS Credits page to pay.",
  };
}

const sourceLabel = (source: string | null) => (source ? source.replace(/_/g, " ") : "other");

function dateKey(at: number, timeZone?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}
function whenLabel(at: number | null, timeZone?: string) {
  if (!at) return "unknown time";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  }).format(new Date(at));
}

/** Same search as the SMS log page (receiver, message, status, detail, kind). */
export function matchesSmsLogSearch(row: SmsLogEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.senderName, row.receiverPhone, row.receiverName, row.message, row.status, row.statusDetail, row.source]
    .some((value) => typeof value === "string" && value.toLowerCase().includes(q));
}

export type SmsLogFilters = { search?: string; status?: string; since?: string; page?: number };

/** The SMS log for Sophie: 10 rows per page, counts by kind and status. The log holds the last 100 messages. */
export function summarizeSmsLog(logs: SmsLogEntry[], filters: SmsLogFilters = {}, timeZone?: string): VoiceResult {
  const search = filters.search?.trim() ?? "";
  const status = filters.status?.trim().toLowerCase() ?? "";
  const since = /^\d{4}-\d{2}-\d{2}$/.test(filters.since ?? "") ? filters.since! : "";
  const visible = logs.filter((row) => matchesSmsLogSearch(row, search)
    && (!status || row.status === status)
    && (!since || (row.createdAt !== null && dateKey(row.createdAt, timeZone) >= since)));
  const pages = Math.max(1, Math.ceil(visible.length / SMS_LIMITS.logPageSize));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pages);
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of visible) {
    byKind[sourceLabel(row.source)] = (byKind[sourceLabel(row.source)] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  const full = logs.length >= 100;
  return {
    status: visible.length ? "OK" : logs.length ? "NO_MATCH" : "NO_MESSAGES",
    total: visible.length, page, pages, byKind, byStatus,
    entries: visible.slice((page - 1) * SMS_LIMITS.logPageSize, page * SMS_LIMITS.logPageSize).map((row) => ({
      when: whenLabel(row.createdAt, timeZone),
      to: row.receiverName || `number ending ${phoneEnding(row.receiverPhone)}`,
      kind: sourceLabel(row.source),
      status: row.status,
      detail: row.statusDetail ? row.statusDetail.replace(/_/g, " ") : null,
      message: row.message,
    })),
    message: (logs.length
      ? "Read the newest few (when, to whom, kind, status) or the counts if that is all the owner asked. Read a full message only when asked. " +
        "Do not read out phone numbers."
      : "No SMS has been sent yet.") +
      (full ? " The log keeps only the last 100 messages: say counts are within those." : ""),
  };
}

export type SmsCustomer = { id: string; fullName: string; phone: string };

const normName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
/** "testcus1 at gmail dot com" and "testcus1@gmail.com" compare equal. */
const compactName = (value: string) => normName(value).replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "");
const digitsOf = (value: string) => value.replace(/\D/g, "");
/** A spoken number or ending matches the phone: "218", "3456789", or a local number like 0412 345 678. */
const phoneEndsWith = (phone: string, digits: string) =>
  digitsOf(phone).endsWith(digits) || (digits.startsWith("0") && digits.length >= 8 && digitsOf(phone).endsWith(digits.slice(1)));

/**
 * The shortest phone ending (at least 3 digits) that tells each customer apart from the others given, so two
 * numbers that both end in 789 are read as "…3456789" and "…2456789" rather than both as "789".
 */
export function distinctPhoneEndings(customers: SmsCustomer[]): Map<string, string> {
  const endings = new Map<string, string>();
  for (const customer of customers) {
    const digits = digitsOf(customer.phone);
    let length = Math.min(3, digits.length);
    while (length < digits.length &&
      customers.some((other) => other.id !== customer.id && digitsOf(other.phone).slice(-length) === digits.slice(-length))) length += 1;
    endings.set(customer.id, digits.slice(-length));
  }
  return endings;
}

/** Phone endings for a list: 3 digits, longer only where two customers with the same name need telling apart. */
function endingsFor(customers: SmsCustomer[]): Map<string, string> {
  const groups = new Map<string, SmsCustomer[]>();
  for (const customer of customers) groups.set(normName(customer.fullName), [...(groups.get(normName(customer.fullName)) ?? []), customer]);
  const endings = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length === 1) endings.set(group[0].id, phoneEnding(group[0].phone));
    else for (const [id, ending] of distinctPhoneEndings(group)) endings.set(id, ending);
  }
  return endings;
}

/** Customers who can get a text, filtered like the page's search (name or phone). */
export function summarizeSmsCustomers(customers: SmsCustomer[], search = ""): VoiceResult {
  const q = search.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const visible = q
    ? customers.filter((customer) => customer.fullName.toLowerCase().includes(q) || (digits.length >= 3 && customer.phone.replace(/\D/g, "").includes(digits)))
    : customers;
  const shown = visible.slice(0, SMS_LIMITS.customersMax);
  const endings = endingsFor(shown);
  return {
    status: visible.length ? "OK" : customers.length ? "NO_MATCH" : "NO_CUSTOMERS",
    total: customers.length, shown: shown.length,
    customers: shown.map((customer) => ({ name: customer.fullName, phoneEnding: endings.get(customer.id) ?? phoneEnding(customer.phone) })),
    complete: visible.length <= SMS_LIMITS.customersMax,
    message: customers.length
      ? "Read the names, or the count. To tick someone, send their name exactly as listed (numbers in a name are part of it). " +
        "Use the phone ending only to tell two customers with the same name apart."
      : "No customers have a phone number yet, so there is nobody to text.",
  };
}

/** Customers whose name matches what was said: the whole name first, then part of it. */
function byName(customers: SmsCustomer[], said: string): SmsCustomer[] {
  const whole = normName(said);
  const compact = compactName(said);
  if (!whole) return customers;
  const exact = customers.filter((customer) => normName(customer.fullName) === whole || compactName(customer.fullName) === compact);
  if (exact.length) return exact;
  return customers.filter((customer) => {
    const name = normName(customer.fullName);
    return name.includes(whole) || name.split(" ").includes(whole) || (compact.length >= 3 && compactName(customer.fullName).includes(compact));
  });
}

/**
 * The customers that fit what the owner said. The whole name counts first, digits and all ("Test Customer 1",
 * "testcus1@gmail.com"). Then a name followed by a phone ending ("John Smith 218"), or a number alone.
 */
function findSmsCustomers(customers: SmsCustomer[], said: string): SmsCustomer[] {
  const whole = byName(customers, said);
  const exact = whole.filter((customer) => normName(customer.fullName) === normName(said) || compactName(customer.fullName) === compactName(said));
  if (exact.length) return exact;
  const tail = /^(.*?)[\s,]*(?:(?:phone|number|mobile)\s*)?(?:ending(?:\s+in)?\s*)?([+\d][\d\s()-]{2,})$/i.exec(said.trim());
  const digits = tail ? digitsOf(tail[2]) : "";
  if (tail && digits.length >= 3) {
    const named = tail[1].trim() ? byName(customers, tail[1]) : customers;
    const withEnding = named.filter((customer) => phoneEndsWith(customer.phone, digits));
    if (withEnding.length) return withEnding;
  }
  return whole;
}

/**
 * Finds each customer the owner named. Every name must match exactly one customer; when several match (two
 * customers with the same name), their distinct phone endings are returned to ask with.
 */
export function matchSmsCustomers(customers: SmsCustomer[], spoken: string[]):
  { ok: true; matched: SmsCustomer[] } | { ok: false; result: VoiceResult } {
  const matched: SmsCustomer[] = [];
  for (const raw of spoken) {
    const said = raw.trim();
    if (!said) continue;
    const found = findSmsCustomers(customers, said);
    if (found.length === 1) { matched.push(found[0]); continue; }
    if (found.length > 1) {
      const endings = distinctPhoneEndings(found);
      return { ok: false, result: {
        status: "AMBIGUOUS", said,
        names: found.slice(0, 20).map((customer) => `${customer.fullName} (phone ending ${endings.get(customer.id)})`),
        message: `Several customers match "${said}". Read out these names and ask which one. Then send the full name exactly as listed, ` +
          "adding the phone ending only if two have the same name.",
      } };
    }
    return { ok: false, result: {
      status: "NO_MATCH", said, names: customers.slice(0, 20).map((customer) => customer.fullName),
      message: customers.length
        ? `No customer with a phone number matches "${said}". Read out some names and ask who they meant.`
        : "No customers have a phone number yet.",
    } };
  }
  return { ok: true, matched: [...new Map(matched.map((customer) => [customer.id, customer])).values()] };
}

/**
 * Checks a send and builds the read-back: the exact text customers receive, who gets it, the credits it
 * uses and what is left. The page's review and prepare_sms_send both use it, so they cannot differ.
 */
export function smsSendReadBack(input: {
  message: string;
  businessName: string | null | undefined;
  recipients: SmsCustomer[];
  all: boolean;
  balance: BusinessSmsBalance | null;
}): { ok: true; outbound: string; summary: string; details: Record<string, unknown> } | { ok: false; result: VoiceResult } {
  const outbound = previewOutboundMessage(input.message, input.businessName);
  if (!input.message.trim()) return { ok: false, result: { status: "NO_MESSAGE", message: "There is no message yet. Ask what to say." } };
  if (outbound.length > SMS_LIMITS.messageMax) {
    return { ok: false, result: {
      status: "TOO_LONG", length: outbound.length, max: SMS_LIMITS.messageMax,
      message: `The message is ${outbound.length} characters with the business name; the limit is ${SMS_LIMITS.messageMax}. Offer a shorter version.`,
    } };
  }
  const count = input.recipients.length;
  if (!count) return { ok: false, result: { status: "NO_RECIPIENTS", message: "Nobody is selected. Ask who should get it: everyone, or which customers." } };
  const remaining = input.balance && !input.balance.isUnlimited ? input.balance.remaining ?? 0 : null;
  if (remaining !== null && count > remaining) {
    return { ok: false, result: {
      status: "NOT_ENOUGH_CREDITS", needed: count, remaining,
      message: `This needs ${count} credits but only ${remaining} are left. Offer fewer customers, or the owner can top up on the SMS Credits page.`,
    } };
  }
  const who = input.all
    ? `all ${plural(count, "customer")}`
    : count <= SMS_LIMITS.namesReadOut
      ? input.recipients.map((customer) => customer.fullName).join(", ")
      : plural(count, "selected customer");
  const credits = remaining === null ? "unlimited plan" : `uses ${plural(count, "credit")}, ${remaining - count} left after`;
  const summary = `Send to ${who} (${credits}): "${outbound}"`;
  return {
    ok: true, outbound, summary,
    details: { outbound, recipients: count, all: input.all, credits: count, remainingAfter: remaining === null ? null : remaining - count },
  };
}

// ---- Page connections ----------------------------------------------------------------------------

export type SmsLogPageVoice = { show(filters: { search: string; page: number }): void };
export type SmsMessageVoice = {
  /** The customers the page loaded (no extra request), and its search box follows `search`. */
  customers(search: string): SmsCustomer[];
  step(args: SmsMessageArgs): VoiceResult | Promise<VoiceResult>;
};

function slot<T>(missing: string) {
  let current: T | null = null;
  return {
    register(handler: T) { current = handler; return () => { if (current === handler) current = null; }; },
    current: () => current,
    async run(apply: (handler: T) => VoiceResult | Promise<VoiceResult>, timeoutMs = 8_000): Promise<VoiceResult> {
      const until = Date.now() + timeoutMs;
      while (!current && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
      return current ? apply(current) : { status: "NOT_OPEN", message: missing };
    },
  };
}
export const smsLogVoice = slot<SmsLogPageVoice>("The SMS log did not load. Ask the owner to open it, then try again.");
export const smsMessageVoice = slot<SmsMessageVoice>("The Custom messages page is not open. Call open_custom_message first.");

// ---- Realtime tool definitions (JSON Schema) -----------------------------------------------------

export function ownerSmsSessionTools() {
  return [
    {
      type: "function", name: SHOW_SMS_BALANCE_TOOL,
      description: "Read the SMS balance: SMS left, used, total, the plan, and the top-up packages with prices. Read only. open true also opens " +
        "the SMS Credits page. You can never buy a top-up: tell the owner to press Top up package on that page.",
      parameters: { type: "object", properties: { open: { type: "boolean" } }, additionalProperties: false },
    },
    {
      type: "function", name: LIST_SMS_LOG_TOOL,
      description: "Open the SMS log and read it: when, to whom, kind (invoice sent, customer welcome, custom message...), status and detail, " +
        "10 per page, with counts by kind and status. Optional search (receiver name or number, message words, status, kind), status, " +
        "since (YYYY-MM-DD) and page. The page's search box and page follow. Read only.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string" }, status: { type: "string", enum: SMS_LOG_STATUSES }, since: { type: "string", description: "YYYY-MM-DD" },
          page: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function", name: LIST_SMS_CUSTOMERS_TOOL,
      description: "List the customers who can get a text (they have a phone number): names and phone endings, and the total. Optional search " +
        "(name or phone). If the Custom messages page is open its search box follows. Read only.",
      parameters: { type: "object", properties: { search: { type: "string" } }, additionalProperties: false },
    },
    {
      type: "function", name: OPEN_CUSTOM_MESSAGE_TOOL,
      description: "Open the Custom messages page to text customers. Then ask what to say and who gets it (everyone or which customers), " +
        "and use sms_message_step.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function", name: SMS_MESSAGE_STEP_TOOL,
      description: "Drive the Custom messages page like the owner. write types message (your tidy wording of what the owner said; the business " +
        "name is added in front automatically). template picks a quick template. recipients_all switches to All customers; recipients_select " +
        "switches to Select customers, ticks add and unticks remove (full names exactly as listed, numbers included, e.g. \"Test Customer 1\"; " +
        "add the phone ending only when two share a name). search types in the customer search; " +
        "select_all_shown ticks everyone the search shows; clear_selection unticks all. scroll_down / scroll_up scroll. review returns the " +
        "read-back: read the exact text, who gets it (say the number when it is everyone) and the credits, then ask: Should I send it? " +
        "send only after review and a clear yes; it cannot be undone. Any change after review needs a new review. cancel drops the yes and sends nothing.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: SMS_MESSAGE_ACTIONS },
          message: { type: "string" },
          template: { type: "string", enum: SMS_TEMPLATE_IDS },
          add: { type: "array", items: { type: "string" } },
          remove: { type: "array", items: { type: "string" } },
          query: { type: "string" },
        },
        required: ["action"], additionalProperties: false,
      },
    },
  ] as const;
}

// ---- Runner (called from components/owner-voice-session.tsx) -------------------------------------

export type SmsRunContext = { getToken: () => Promise<string>; goTo: (path: string) => void; gate: TeamGate; signal: AbortSignal };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);
const names = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined);

async function getJson(path: string, context: SmsRunContext) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${await context.getToken()}` }, cache: "no-store",
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]),
  });
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  return response.ok && data && data.ok !== false ? data : null;
}

export async function runOwnerSmsTool(name: OwnerSmsToolName, rawArguments: string, context: SmsRunContext): Promise<VoiceResult> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}") as Record<string, unknown>; } catch { return { status: "REJECTED", message: "Send valid arguments." }; }
  const { gate } = context;

  if (name === SHOW_SMS_BALANCE_TOOL) {
    if (args.open === true) context.goTo(SMS_CREDITS_PAGE);
    const data = await getJson("/api/business/sms", context);
    return summarizeSmsBalance((data?.balance ?? null) as BusinessSmsBalance | null,
      Array.isArray(data?.packages) ? data.packages as Parameters<typeof summarizeSmsBalance>[1] : []);
  }

  if (name === LIST_SMS_LOG_TOOL) {
    const status = text(args.status) ?? "";
    if (status && !(SMS_LOG_STATUSES as readonly string[]).includes(status)) return { status: "REJECTED", message: "status must be sent, failed or skipped." };
    context.goTo(SMS_LOG_PAGE);
    const data = await getJson("/api/business/sms-log", context);
    if (!Array.isArray(data?.logs)) return { status: "UNAVAILABLE", message: "Could not load the SMS log." };
    const filters = { search: text(args.search) ?? "", status, since: text(args.since), page: typeof args.page === "number" ? args.page : 1 };
    const result = summarizeSmsLog(data.logs as SmsLogEntry[], filters);
    // The open page shows the same: its search box takes the words (or the status), and the same page.
    void smsLogVoice.run((page) => { page.show({ search: filters.search || status, page: Number(result.page) || 1 }); return result; }, 8_000);
    return result;
  }

  if (name === LIST_SMS_CUSTOMERS_TOOL) {
    const search = text(args.search) ?? "";
    const page = smsMessageVoice.current();
    if (page) return summarizeSmsCustomers(page.customers(search), search); // the page already loaded them
    const data = await getJson("/api/business/custom-messages", context);
    if (!Array.isArray(data?.customers)) return { status: "UNAVAILABLE", message: "Could not load the customers." };
    return summarizeSmsCustomers(data.customers as SmsCustomer[], search);
  }

  if (name === OPEN_CUSTOM_MESSAGE_TOOL) {
    context.goTo(CUSTOM_MESSAGES_PAGE);
    clear(gate);
    return smsMessageVoice.run(() => ({
      status: "OPENED", message: "The Custom messages page is open. Ask what the message should say and who gets it (everyone or which customers).",
    }), 10_000);
  }

  // sms_message_step
  const action = text(args.action) ?? "";
  if (!(SMS_MESSAGE_ACTIONS as readonly string[]).includes(action)) {
    return { status: "REJECTED", message: `action must be one of: ${SMS_MESSAGE_ACTIONS.join(", ")}.` };
  }
  if (action === "template" && !(SMS_TEMPLATE_IDS as string[]).includes(text(args.template) ?? "")) {
    return { status: "REJECTED", message: `template must be one of: ${SMS_TEMPLATE_IDS.join(", ")}.` };
  }
  if (action === "send") {
    const refusal = blocked(gate, (kind) => kind === "sms_send");
    if (refusal) return refusal;
  }
  if (action === "cancel") clear(gate);
  const result = await smsMessageVoice.run((form) => form.step({
    action: action as SmsMessageAction,
    ...(text(args.message) !== undefined ? { message: text(args.message) } : {}),
    ...(text(args.template) !== undefined ? { template: text(args.template) as SmsTemplateId } : {}),
    ...(names(args.add) ? { add: names(args.add) } : {}),
    ...(names(args.remove) ? { remove: names(args.remove) } : {}),
    ...(text(args.query) !== undefined ? { query: text(args.query) } : {}),
  }), 3_000);
  if (result.status === "REVIEW") ask(gate, "sms_send");
  // A change after the read-back means the owner's yes no longer covers what would be sent.
  if ((SMS_CHANGING_ACTIONS as readonly string[]).includes(action) && result.status === "OK" && gate.kind === "sms_send") clear(gate);
  if (result.status === "SENT" || result.status === "CANCELLED" || result.status === "NOT_REVIEWED") clear(gate);
  return result;
}
