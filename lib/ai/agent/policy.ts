/**
 * The policy check (docs/sophie-autonomous-agent-plan.md §4.6). Every action, automatic or
 * owner-approved, passes it at the moment of acting, because things change after a card is made.
 *
 * Pure: the caller gathers the facts (customer record, opt-out, today's count …) and this decides.
 * Dry run is reported alongside the decision, so the log shows what *would* have happened.
 */

import { scanKnowledgeText } from "@/lib/ai/learning/redact";
import { currentClockMinutesInTimeZone } from "@/lib/platform/timezone";

import type { AgentFlags } from "./config";
import type { AutomationLevel } from "./types";

export type PolicyOutcome =
  /** Do it now. */
  | "allow"
  /** Make a card and ask the owner. */
  | "suggest"
  /** Never do it. */
  | "blocked"
  /** Do it later: check again at `holdUntil`. */
  | "held"
  /** Already done under the same dedupe key. */
  | "skipped";

export type PolicyReason =
  | "OK"
  | "DUPLICATE"
  | "PAUSED"
  | "RULE_OFF"
  | "NOT_CUSTOMER"
  | "RECORD_CHANGED"
  | "OPTED_OUT"
  | "NO_LONGER_NEEDED"
  | "UNSAFE_CONTENT"
  | "NEEDS_OWNER"
  | "AUTO_NOT_ALLOWED"
  | "CONTENT_REVIEW"
  | "CUSTOMER_GAP"
  | "DAILY_CAP"
  | "OUTSIDE_HOURS";

export type PolicyDecision = {
  outcome: PolicyOutcome;
  reason: PolicyReason;
  holdUntil: number | null;
  /** True when the platform is off or in dry run: log the decision, act on nothing. */
  dryRun: boolean;
};

export type PolicyFacts = {
  now: number;
  flags: AgentFlags;
  /** The business pressed Pause. Pausing stops everything not yet done. */
  businessPaused: boolean;
  /** Who allowed it: a rule at its level, or the owner approving this exact action on a card. */
  authority: { kind: "rule"; level: AutomationLevel } | { kind: "owner_approved" };
  /** The platform switch for automatic actions of this kind, e.g. `AI_EMAIL_AUTO_ENABLED`. */
  autoAllowed: boolean;
  /** On the never-automatic list (email plan §12): a rule can only suggest it. */
  neverAuto: boolean;
  /** The action's dedupe key (`agent:${ruleId}:${entityId}:${step}`) was already used. */
  dedupeKeyUsed: boolean;
  /** Stop conditions: the quote is still open, the job isn't cancelled, nobody replied since … */
  stillNeeded: boolean;
  /** Set when the action contacts someone outside the business; null for internal actions. */
  contact: null | {
    /** Sophie may only write to a saved customer or the sender of the thread (email plan §12). */
    recipient: "saved_customer" | "thread_sender" | "other";
    /** The record still matches the version the action was built from. */
    recordCurrent: boolean;
    optedOut: boolean;
    /** Last automated contact with this person, or null when the 48-hour gap doesn't apply (answering their own email). */
    lastAutomatedContactAt: number | null;
    sentToday: number;
    dailyCap: number;
    /** Local sending hours, e.g. 7 to 20 for 7 am–8 pm. */
    window: { timeZone: string; startHour: number; endHour: number };
  };
  /** Text that will leave the business, if any. */
  text: string | null;
};

export const CUSTOMER_GAP_MS = 48 * 60 * 60_000;
const DAY_MINUTES = 24 * 60;
/** When the local time can't be worked out, wait this long and check again. */
const UNKNOWN_TIME_RETRY_MINUTES = 60;

const SECRET_WORDS = /\b(passwords?|passcodes?|security codes?|one[- ]time (?:codes?|passwords?)|cvv|cvc)\b/i;
const BANK_DETAILS = /\b(bsb|account (?:number|no\.?)|bank (?:details|account))\b/i;
const CARD_LIKE = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Checks text that will leave the business (plan §4.6, check 11).
 * `unsafe`: card numbers or secrets, never sent. `review`: bank details or text that reads like
 * instructions to an AI, which the owner must see first.
 */
export function scanOutgoingText(text: string | null): "clean" | "review" | "unsafe" {
  if (!text) return "clean";
  const cards = text.match(CARD_LIKE) ?? [];
  if (SECRET_WORDS.test(text) || cards.some((match) => passesLuhn(match.replace(/\D/g, "")))) return "unsafe";
  if (BANK_DETAILS.test(text) || scanKnowledgeText(text).includes("instruction_like")) return "review";
  return "clean";
}

function localMinutes(now: number, timeZone: string): number | null {
  try {
    return currentClockMinutesInTimeZone(new Date(now), timeZone);
  } catch {
    return null; // an invalid time zone: fail closed
  }
}

/** Minutes until the local window opens; 0 when it is open now. */
export function minutesUntilWindow(local: number, startHour: number, endHour: number): number {
  const start = startHour * 60;
  const end = endHour * 60;
  if (!(start >= 0 && end <= DAY_MINUTES && start < end)) return UNKNOWN_TIME_RETRY_MINUTES;
  if (local >= start && local < end) return 0;
  return local < start ? start - local : DAY_MINUTES - local + start;
}

export function checkPolicy(facts: PolicyFacts): PolicyDecision {
  return { ...decide(facts), dryRun: !facts.flags.enabled || facts.flags.dryRun };
}

function decide(facts: PolicyFacts): Omit<PolicyDecision, "dryRun"> {
  const result = (outcome: PolicyOutcome, reason: PolicyReason, holdUntil: number | null = null) =>
    ({ outcome, reason, holdUntil });
  const { authority, contact } = facts;

  // Checks that stop the action whoever allowed it.
  if (facts.dedupeKeyUsed) return result("skipped", "DUPLICATE");
  if (facts.businessPaused) return result("blocked", "PAUSED");
  if (authority.kind === "rule" && authority.level === "off") return result("blocked", "RULE_OFF");
  if (contact) {
    if (contact.recipient === "other") return result("blocked", "NOT_CUSTOMER");
    if (!contact.recordCurrent) return result("blocked", "RECORD_CHANGED");
    if (contact.optedOut) return result("blocked", "OPTED_OUT");
  }
  if (!facts.stillNeeded) return result("blocked", "NO_LONGER_NEEDED");
  const content = scanOutgoingText(facts.text);
  if (content === "unsafe") return result("blocked", "UNSAFE_CONTENT");

  // A rule may act alone only at `auto`, only where the platform allows it, never for the
  // never-automatic list, and never with text the owner should read first. The owner approving
  // this exact action on a card already covers all four.
  if (authority.kind === "rule") {
    if (authority.level === "suggest") return result("suggest", "OK");
    if (facts.neverAuto) return result("suggest", "NEEDS_OWNER");
    if (!facts.autoAllowed) return result("suggest", "AUTO_NOT_ALLOWED");
    if (content === "review") return result("suggest", "CONTENT_REVIEW");
  }

  // Allowed. For contact, the limits decide when.
  if (contact) {
    const { lastAutomatedContactAt, window } = contact;
    if (lastAutomatedContactAt !== null && facts.now - lastAutomatedContactAt < CUSTOMER_GAP_MS) {
      return result("held", "CUSTOMER_GAP", lastAutomatedContactAt + CUSTOMER_GAP_MS);
    }
    const local = localMinutes(facts.now, window.timeZone);
    if (contact.sentToday >= contact.dailyCap) {
      const untilMidnight = local === null ? UNKNOWN_TIME_RETRY_MINUTES : DAY_MINUTES - local;
      return result("held", "DAILY_CAP", facts.now + untilMidnight * 60_000);
    }
    const wait = local === null ? UNKNOWN_TIME_RETRY_MINUTES : minutesUntilWindow(local, window.startHour, window.endHour);
    if (wait > 0) return result("held", "OUTSIDE_HOURS", facts.now + wait * 60_000);
  }
  return result("allow", "OK");
}
