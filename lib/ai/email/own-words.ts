import "server-only";

import { runWriterJob, type WriterConfig, type WriterFailure } from "@/lib/ai/agent/writer";

import { actionLabel, PICKABLE_ACTIONS, parseActions } from "./action-list";
import type { EmailAction, EmailActionKind } from "./types";

/**
 * The owner's own words (docs/sophie-email-learning-and-auto-reply.md §5.7): "Put council letters in
 * a Council folder and remind me a week before the date." The AI only maps the words onto the fixed
 * action list; the code checks the answer, and Sophie reads it back. Nothing is saved here: the owner
 * says "Yes, that's right" and the actions go through the card or group answer like any other.
 *
 * Anything that isn't on the list is named back as "I can't do that yet", never invented. Business
 * facts are pointed to Sophie's knowledge, not turned into actions.
 */

export const OWN_WORDS_MAX = 500;

export type OwnWords = {
  actions: EmailAction[];
  /** "Move it to the "Council" folder, then add a calendar reminder 7 days before the date." */
  readBack: string;
  /** Things the owner asked for that aren't on the list, e.g. "forward them to my accountant". */
  unsupported: string[];
  /** Facts about the business found in the words, e.g. "we don't go out to Penrith". */
  facts: string[];
};

/** Replies are picked from the template list on the card, not from free words. */
const WORD_ACTIONS = PICKABLE_ACTIONS.filter((kind): kind is Exclude<EmailActionKind, "reply" | "resend_document" | "open_complaint_case" | "propose_reschedule"> => kind !== "reply" && kind !== "resend_document" && kind !== "open_complaint_case" && kind !== "propose_reschedule");

const ACTION_MEANINGS: Record<Exclude<EmailActionKind, "reply" | "resend_document" | "open_complaint_case" | "propose_reschedule">, string> = {
  save_customer: "save the sender as a customer",
  link_thread: "link the email to the customer's records",
  create_inspection: "add a pending site inspection request",
  create_job_request: "add a pending job request",
  add_bill_item: "add the email to the bills list",
  pause_reminders: "pause payment reminders for the invoice (reason: payment_claim when they say they paid, dispute when they dispute it)",
  add_calendar_reminder: "add a calendar reminder a number of days (daysBefore, 1 to 60) before a date written in the email; \"a week\" is 7",
  move_folder: "move the email to a folder (folder: the folder name the owner gave, up to 40 letters, numbers, spaces, - or _)",
  mark_read: "mark the email as read",
  notify_owner: "tell the owner (urgency: now for straight away, today for a normal notification, routine to just show it in the queue)",
  ignore: "do nothing with it (only on its own)",
};

const INSTRUCTIONS = [
  "The data is a business owner's own words about what to do with a kind of email. Turn them into steps from this fixed list, in the order the owner said them:",
  ...WORD_ACTIONS.map((kind) => `- ${kind}: ${ACTION_MEANINGS[kind]}`),
  "Use each step at most once. Set folder, daysBefore, urgency and reason only for the step that needs them, and null otherwise.",
  "Anything the owner asks for that isn't on the list (forwarding, writing a reply, paying, deleting, changing prices, telling staff …) goes in unsupported, in a few plain words. Never stretch a step to cover it.",
  "A fact about the business (areas, prices, opening hours, services) goes in facts, in a few plain words. It is not a step.",
  "If the words don't ask for anything on the list, return no steps.",
].join("\n");

export function ownWordsSchema(): Record<string, unknown> {
  const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
  return {
    type: "object",
    additionalProperties: false,
    required: ["actions", "unsupported", "facts"],
    properties: {
      actions: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "folder", "daysBefore", "urgency", "reason"],
          properties: {
            kind: { type: "string", enum: [...WORD_ACTIONS] },
            folder: nullable({ type: "string" }),
            daysBefore: nullable({ type: "integer" }),
            urgency: nullable({ type: "string", enum: ["now", "today", "routine"] }),
            reason: nullable({ type: "string", enum: ["payment_claim", "dispute"] }),
          },
        },
      },
      unsupported: { type: "array", maxItems: 5, items: { type: "string" } },
      facts: { type: "array", maxItems: 5, items: { type: "string" } },
    },
  };
}

const short = (items: unknown): string[] => (Array.isArray(items) ? items : [])
  .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 80))
  .slice(0, 5);

/** Checks the AI's answer against the fixed list. Null when any step is off it or malformed. */
export function parseOwnWords(raw: unknown): OwnWords | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { actions?: unknown; unsupported?: unknown; facts?: unknown };
  if (!Array.isArray(value.actions)) return null;
  // Only the fields each step uses go on to the code's own check.
  const steps = value.actions.map((item) => {
    const step = (item ?? {}) as Record<string, unknown>;
    switch (step.kind) {
      case "move_folder": return { kind: step.kind, folder: step.folder };
      case "add_calendar_reminder": return { kind: step.kind, daysBefore: step.daysBefore };
      case "notify_owner": return { kind: step.kind, urgency: step.urgency ?? "today" };
      case "pause_reminders": return { kind: step.kind, reason: step.reason ?? "payment_claim" };
      default: return { kind: step.kind };
    }
  });
  const actions = parseActions(steps);
  if (!actions) return null;
  return { actions, readBack: readBack(actions), unsupported: short(value.unsupported), facts: short(value.facts) };
}

/** Sophie's read-back of the steps, in the card's own words. */
export function readBack(actions: readonly EmailAction[]): string {
  if (actions.length === 0) return "";
  const labels = actions.map((action, index) => {
    const label = actionLabel(action);
    return index === 0 ? label : label[0].toLowerCase() + label.slice(1);
  });
  return `${labels.join(", then ")}.`;
}

export type OwnWordsResult =
  | { ok: true; value: OwnWords }
  | { ok: false; reason: "empty" | "too_long" | "nothing_to_do" | WriterFailure };

export async function readOwnWords(
  text: unknown,
  options: { config?: WriterConfig | null; fetchImpl?: typeof fetch } = {},
): Promise<OwnWordsResult> {
  const words = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!words) return { ok: false, reason: "empty" };
  if (words.length > OWN_WORDS_MAX) return { ok: false, reason: "too_long" };
  const result = await runWriterJob({
    name: "email_own_words",
    instructions: INSTRUCTIONS,
    data: { ownerWords: words },
    schema: ownWordsSchema(),
    parse: parseOwnWords,
    timeoutMs: 20_000,
  }, options.config, options.fetchImpl);
  if (!result.ok) return result;
  if (result.value.actions.length === 0 && result.value.unsupported.length === 0 && result.value.facts.length === 0) {
    return { ok: false, reason: "nothing_to_do" };
  }
  return result;
}
