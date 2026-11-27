import { minutesUntilWindow, scanOutgoingText } from "@/lib/ai/agent/policy";
import { currentClockMinutesInTimeZone } from "@/lib/platform/timezone";

/**
 * The reply safety gate (docs/sophie-email-learning-and-auto-reply.md §8.2). Pure: the caller
 * gathers the facts at the moment of sending, after the general policy check.
 *
 * The owner approving a reply on its card covers the caps and the email hours: it goes now. A
 * rule's reply must pass every check; anything unclear goes to the owner, and outside the email
 * hours it waits.
 */

export const EMAIL_HOURS = { startHour: 7, endHour: 20 };
/** A rule's replies per business per local day. */
export const AUTO_REPLY_DAILY_CAP = 50;
/** One automatic reply per thread per 24 hours. */
export const THREAD_GAP_MS = 24 * 60 * 60_000;

export type ReplyGateFacts = {
  now: number;
  authority: "owner" | "rule";
  /** AI_EMAIL_AUTO_REPLY_ENABLED: a rule may send replies (step 8 pilot). */
  autoReplyAllowed: boolean;
  /** The pre-check found an automated sender: noreply, a list, bulk or an auto-reply (§4.1). */
  neverReply: boolean;
  privateSender: boolean;
  /** The sender replied STOP to one of Sophie's emails. */
  optedOut: boolean;
  /** Someone asked for a person in this thread. */
  personRequested: boolean;
  /** The address the reply goes to: the From address, never Reply-To (T23). */
  replyTo: string | null;
  /** A newer email in the thread from the customer, or the owner already answered. */
  threadChanged: boolean;
  /** The mailbox is connected and may send. */
  mailboxReady: boolean;
  lastSophieReplyAt: number | null;
  repliesToday: number;
  timeZone: string;
  text: string;
};

export type ReplyGate =
  | { outcome: "send" }
  /** Not sent now: try again at `until`. */
  | { outcome: "hold"; reason: "OUTSIDE_HOURS" | "DAILY_CAP"; until: number }
  /** Not sent: the owner decides, with this reason. */
  | { outcome: "ask"; reason: string }
  /** Never sent, and nothing to ask: e.g. an automated sender. */
  | { outcome: "skip"; reason: string };

export function checkReplyGate(facts: ReplyGateFacts): ReplyGate {
  if (facts.neverReply) return { outcome: "skip", reason: "It came from an automatic sender, so I don't reply to it." };
  if (facts.privateSender) return { outcome: "skip", reason: "This sender is private." };
  if (facts.optedOut) return { outcome: "skip", reason: "They asked not to get emails from me." };
  if (!facts.replyTo) return { outcome: "ask", reason: "I couldn't tell who to reply to." };
  if (!facts.mailboxReady) return { outcome: "ask", reason: "Reconnect your mailbox, with permission to send, and I'll reply next time." };
  const scan = scanOutgoingText(facts.text);
  if (scan === "unsafe") return { outcome: "ask", reason: "The reply would include something I must never send." };
  if (facts.personRequested) return { outcome: "ask", reason: "They asked for a person, so I've left it to you." };
  if (facts.threadChanged) return { outcome: "ask", reason: "There's newer email in this conversation, so I didn't reply." };
  if (facts.authority === "owner") return { outcome: "send" };

  // A rule's reply, on its own.
  if (!facts.autoReplyAllowed) return { outcome: "ask", reason: "I'm not allowed to send replies by myself yet." };
  if (scan === "review") return { outcome: "ask", reason: "The reply mentions bank or payment details, so you should read it first." };
  if (facts.lastSophieReplyAt !== null && facts.now - facts.lastSophieReplyAt < THREAD_GAP_MS) {
    return { outcome: "ask", reason: "I already replied in this conversation today." };
  }
  let local: number | null = null;
  try {
    local = currentClockMinutesInTimeZone(new Date(facts.now), facts.timeZone);
  } catch {
    local = null;
  }
  if (local === null) return { outcome: "ask", reason: "I couldn't work out your local time." };
  if (facts.repliesToday >= AUTO_REPLY_DAILY_CAP) {
    return { outcome: "hold", reason: "DAILY_CAP", until: facts.now + (24 * 60 - local + EMAIL_HOURS.startHour * 60) * 60_000 };
  }
  const wait = minutesUntilWindow(local, EMAIL_HOURS.startHour, EMAIL_HOURS.endHour);
  if (wait > 0) return { outcome: "hold", reason: "OUTSIDE_HOURS", until: facts.now + wait * 60_000 };
  return { outcome: "send" };
}
