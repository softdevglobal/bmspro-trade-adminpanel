import type { HoursAnswer } from "./hours";
import type { StatusFact } from "./status";
import { greetingFor, type EmailStyle } from "./style";

/**
 * Sophie's built-in reply templates (docs/sophie-email-learning-and-auto-reply.md §8.1 R1, §8.3,
 * §8.5, §8.8). Pure. Every fact in a reply comes from records the caller reads; a template whose
 * required facts are missing isn't sent (the owner is asked), and Sophie never fills a slot with a
 * guess. The words are fixed here: no AI writes any part of them.
 *
 * Every reply says Sophie is an AI assistant, near the top of the first reply in a thread and in
 * the signature, and tells the customer how to reach a person and how to stop these emails.
 */

export const REPLY_TEMPLATE_IDS = [
  "request_received",
  "enquiry_received",
  "friendly_thanks",
  "compliment_thanks",
  "season_greeting",
  "person_passed_on",
  "hours_answer",
  "status_answer",
  "complaint_received",
  "complaint_return_visit_offer",
  "complaint_follow_up",
  "reschedule_received",
] as const;
/** Templates an owner or a rule can pick. */
export type ReplyTemplateId = (typeof REPLY_TEMPLATE_IDS)[number];
/** Plus the safety reply (§10.5), which only the safety path sends, never a card or a rule. */
export type TemplateId = ReplyTemplateId | "safety_holding";

/** A template the owner approved (docs §8.1, R2): `custom_<40 hex>`, read at the moment of sending. */
export type CustomTemplateRef = `custom_${string}`;
export const isCustomTemplate = (value: unknown): value is CustomTemplateRef => typeof value === "string" && /^custom_[0-9a-f]{40}$/.test(value);

export const isReplyTemplate = (value: unknown): value is ReplyTemplateId | CustomTemplateRef =>
  isCustomTemplate(value) || (typeof value === "string" && (REPLY_TEMPLATE_IDS as readonly string[]).includes(value));

/** Facts from records. Null or empty means "not known". */
export type ReplyFacts = {
  businessName: string | null;
  businessPhone: string | null;
  ownerFirstName: string | null;
  /** From the customer record (verified) or the details the owner confirmed on the card. */
  firstName: string | null;
  /** From the request the owner confirmed (step 6b). */
  serviceName: string | null;
  suburb: string | null;
  originalSubject: string;
  /** No earlier Sophie reply in this thread: the reply introduces her. */
  firstInThread: boolean;
  /** For hours_answer: worked out from the hours, open days and closures (hours.ts). */
  hours?: HoursAnswer | null;
  /** For status_answer: the one record that answers the question (status.ts). */
  status?: StatusFact | null;
  /** For complaint_received: "9 am Thursday 4 December". */
  responseBy?: string | null;
  /** For hours_answer, a verified customer only: one line about their visit in the next 7 days (§8.6). */
  visitLine?: string | null;
  /** For reschedule_received: the one open booking they mean, from their own records. */
  bookingCode?: string | null;
  /** For a saved template (R2): the owner's approved wording, with {firstName} as its one slot. */
  customBody?: string | null;
  /** For complaint_return_visit_offer: the times offered, as written ("Saturday 28 November, 8 am to 9 am"). */
  offerTimes?: string[] | null;
};

type Template = {
  title: string;
  version: number;
  /** Facts that must be known, or the reply isn't sent. */
  requires: (keyof ReplyFacts)[];
  /** One or more variants of the middle of the email. Sophie rotates them (§8.8). */
  variants: ((facts: ReplyFacts) => string)[];
  /** An optional extra paragraph after the middle, from records. */
  after?: (facts: ReplyFacts) => string | null;
};

const team = (facts: ReplyFacts) => facts.ownerFirstName || "the team";

export const REPLY_TEMPLATES: Record<TemplateId, Template> = {
  request_received: {
    title: "Request received",
    version: 1,
    requires: ["businessName"],
    variants: [(facts) => {
      const what = facts.serviceName ? ` for ${facts.serviceName}` : "";
      const where = facts.suburb ? ` in ${facts.suburb}` : "";
      const urgent = facts.businessPhone ? `\n\nIf it's urgent, please call us on ${facts.businessPhone}.` : "";
      return `Thanks for getting in touch. We've received your request${what}${where}, and we'll be in touch to confirm a time.${urgent}`;
    }],
  },
  enquiry_received: {
    title: "Thanks, we'll get back to you",
    version: 1,
    requires: ["businessName"],
    variants: [(facts) => `Thanks for your email. We've received it, and ${team(facts)} will get back to you soon.`],
  },
  friendly_thanks: {
    title: "Thank you",
    version: 1,
    requires: ["businessName"],
    variants: [
      (facts) => `Thanks so much${facts.firstName ? `, ${facts.firstName}` : ""}! We're really glad you're happy with our work.`,
      (facts) => `Thank you for letting us know${facts.firstName ? `, ${facts.firstName}` : ""}. It's great to hear you're happy with our work.`,
      (facts) => `That's lovely to hear${facts.firstName ? `, ${facts.firstName}` : ""}. Thank you for taking the time to write.`,
    ],
  },
  compliment_thanks: {
    title: "Thank you, I'll pass it on",
    version: 1,
    requires: ["businessName"],
    variants: [() => "Thank you so much for the kind words. I'll pass them on to the team."],
  },
  season_greeting: {
    title: "Season's greetings",
    version: 1,
    requires: ["businessName"],
    variants: [(facts) => `Thank you, and the same to you from all of us at ${facts.businessName}!`],
  },
  person_passed_on: {
    title: "Passed on to a person",
    version: 1,
    requires: ["businessName"],
    variants: [(facts) => `I've passed this to ${team(facts)}, who will get back to you.`],
  },
  // §8.6: hours_open, hours_closed_day and hours_after_close, chosen from the facts.
  hours_answer: {
    title: "Our opening hours",
    version: 1,
    requires: ["businessName", "hours"],
    variants: [(facts) => {
      const hours = facts.hours!;
      const next = hours.next ? `We're open ${hours.next.dayLabel}, from ${hours.next.start} to ${hours.next.end}.` : "";
      if (hours.template === "hours_open") return `Yes, we're open ${hours.dayLabel}, from ${hours.start} to ${hours.end}.`;
      if (hours.template === "hours_closed_day") return `We're closed ${hours.dayLabel}. ${next.replace("We're open", "We're open again")}`;
      return `${hours.closedWhenSent ? "We'd closed for the day when your email came in." : "That day has finished now."} ${next}`;
    }],
    // The answer, then at most one line from their own booking (tier T1, verified senders only).
    after: (facts) => facts.visitLine ?? null,
  },
  // §9.1: where's my booking, request or quote. One sentence from one record, never an amount.
  status_answer: {
    title: "Where your booking, request or quote is up to",
    version: 1,
    requires: ["businessName", "status"],
    variants: [(facts) => facts.status!.sentence],
  },
  // §10.4 step 3: sympathy, never fault. No staff names, excuses, diagnosis or offers.
  complaint_received: {
    title: "Sorry to hear that, passed on",
    version: 1,
    requires: ["businessName", "responseBy"],
    variants: [(facts) => `I'm sorry to hear about this, and thank you for letting us know. I've passed it to ${team(facts)}, and we'll get back to you by ${facts.responseBy}.`],
  },
  // §10.10: the owner chose these times. The wording offers a visit; it never admits fault or says a price.
  complaint_return_visit_offer: {
    title: "Offer to come back",
    version: 1,
    requires: ["businessName", "offerTimes"],
    variants: [(facts) => `Thank you for your patience. We'd like to put this right, and we can come back on ${facts.offerTimes!.join(" or ")}. Please reply with the time that suits you, and ${team(facts)} will confirm it.`],
  },
  // §10.7: after the return visit. Asks if it's fixed; promises nothing and admits nothing.
  complaint_follow_up: {
    title: "Is it fixed now?",
    version: 1,
    requires: ["businessName"],
    variants: [(facts) => `Thank you again for your patience. Our return visit is finished, and we'd like to be sure everything is working properly now. Please reply to let us know, and if it isn't, ${team(facts)} will take another look.`],
  },
  // §9.1: "can we move our visit?". Acknowledges; never agrees to a time or promises the change.
  reschedule_received: {
    title: "Got your request to change the booking",
    version: 1,
    requires: ["businessName", "bookingCode"],
    variants: [(facts) => `We've received your request to change your booking ${facts.bookingCode}. ${team(facts)} will confirm a new time with you.`],
  },
  safety_holding: {
    title: "Safety: keep clear and call 000",
    version: 1,
    requires: ["businessName", "businessPhone"],
    variants: [(facts) => [
      "Thank you for telling us. If anything is unsafe right now, please keep clear of it and call 000 in an emergency.",
      `We've alerted ${team(facts)}, and someone will contact you as soon as possible. You can also call us on ${facts.businessPhone}.`,
    ].join(" ")],
  },
};

export const templateTitle = (id: TemplateId | CustomTemplateRef) => (isCustomTemplate(id) ? "Your saved reply" : REPLY_TEMPLATES[id].title);

/** The owner's saved wording as a template: the one slot is the customer's first name, left out when it isn't known. */
const CUSTOM: Template = {
  title: "Your saved reply",
  version: 1,
  requires: ["businessName", "customBody"],
  variants: [(facts) => {
    const body = facts.customBody ?? "";
    return facts.firstName
      ? body.replace(/\{firstName\}/g, facts.firstName)
      : body.replace(/,?\s*\{firstName\}/g, "").replace(/\s{2,}/g, " ").replace(/^[,\s]+/, "").replace(/^(\p{Ll})/u, (letter) => letter.toUpperCase());
  }],
};

const clean = (value: string | null | undefined, max: number) => {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

/** A first name safe to print: one word of letters, from a record. Anything else means "Hi there". */
export function safeFirstName(fullName: string | null | undefined): string | null {
  const first = clean(fullName, 80)?.split(" ")[0] ?? "";
  return /^[\p{L}][\p{L}'’-]{0,29}$/u.test(first) ? first : null;
}

export function replySubject(original: string): string {
  const subject = clean(original, 200) ?? "";
  if (!subject) return "Re: your email";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export type RenderedReply = { ok: true; subject: string; body: string; templateVersion: number } | { ok: false; missing: (keyof ReplyFacts)[] };

/** Fills a template from records. `variant` picks the wording (e.g. from the email's id). */
export function renderReply(id: TemplateId | CustomTemplateRef, rawFacts: ReplyFacts, style: EmailStyle, variant = 0): RenderedReply {
  const template = isCustomTemplate(id) ? CUSTOM : REPLY_TEMPLATES[id];
  const facts: ReplyFacts = {
    ...rawFacts,
    businessName: clean(rawFacts.businessName, 80),
    businessPhone: clean(rawFacts.businessPhone, 30),
    ownerFirstName: safeFirstName(rawFacts.ownerFirstName),
    firstName: safeFirstName(rawFacts.firstName),
    serviceName: clean(rawFacts.serviceName, 80),
    suburb: clean(rawFacts.suburb, 60),
    responseBy: clean(rawFacts.responseBy, 60),
    visitLine: clean(rawFacts.visitLine, 160),
    bookingCode: clean(rawFacts.bookingCode, 40),
    customBody: isCustomTemplate(id) ? clean(rawFacts.customBody, 700) : null,
    offerTimes: (rawFacts.offerTimes ?? []).map((time) => clean(time, 80)).filter((time): time is string => !!time).slice(0, 3),
  };
  if (facts.offerTimes?.length === 0) facts.offerTimes = null;
  const missing = template.requires.filter((key) => !facts[key]);
  if (missing.length > 0) return { ok: false, missing };
  const middle = template.variants[Math.abs(variant) % template.variants.length](facts);
  const signature = [
    `Sophie · AI assistant at ${facts.businessName}`,
    `${facts.businessPhone ? `${facts.businessPhone} · ` : ""}Reply "person" to reach ${team(facts)}`,
    "Reply STOP if you'd rather not get emails from our assistant.",
  ].join("\n");
  const body = [
    greetingFor(style, facts.firstName),
    "",
    ...(facts.firstInThread ? [`I'm Sophie, the AI assistant at ${facts.businessName}.`] : []),
    middle,
    ...(template.after?.(facts) ? ["", template.after(facts)!] : []),
    "",
    style.signOff,
    signature,
  ].join("\n");
  return { ok: true, subject: replySubject(facts.originalSubject), body, templateVersion: template.version };
}
