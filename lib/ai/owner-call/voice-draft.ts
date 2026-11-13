/**
 * Voice knowledge drafts: the owner asks Sophie (Talk to Sophie) to add something
 * to the AI knowledge base, and Sophie prepares it as an unpublished draft.
 *
 * The three tools below are offered to the realtime model, but they run in the
 * owner's browser, not on the Trade MCP route:
 *
 *   prepare_knowledge_draft  shows the proposed note on the AI knowledge page. Saves nothing.
 *   save_knowledge_draft     saves that note as a draft through POST /api/ai/knowledge,
 *                            only after the owner has spoken again and did not say no.
 *   discard_knowledge_draft  removes the proposed note.
 *
 * Guardrails (see docs/SOPHIE_AI_AGENT_GUIDE.md, "Voice knowledge drafts"):
 *  - Drafts only. Nothing is published, edited or deleted by voice; only published
 *    entries are ever searched on calls.
 *  - What is saved is what is on screen, not what the model sends with the save call.
 *  - Saving needs a new owner turn after the note was shown, and that turn must not be a "no".
 *  - Short notes only, a few per session, and the server rate-limits voice drafts too.
 *  - The usual risk scan runs before saving (shown as warnings) and again on the server
 *    (flagged entries are saved as needs_review).
 *
 * Pure and browser-safe: no server-only imports, so the browser, the routes and the
 * tests share the same limits and wording.
 */
import { z } from "zod";
import { scanKnowledgeText } from "../learning/redact";

export const VOICE_DRAFT_KINDS = ["faq", "policy", "note"] as const;
export type VoiceDraftKind = (typeof VOICE_DRAFT_KINDS)[number];

/** Spoken notes are short. Longer content belongs in the editor or a file import. */
export const VOICE_DRAFT_BODY_MAX = 2_000;
export const VOICE_DRAFT_TITLE_MAX = 120;
/** Drafts Sophie may save in one voice session (the server also limits per hour). */
export const VOICE_DRAFTS_PER_SESSION = 5;
/** Server-side limit for drafts created by voice, per business. */
export const VOICE_DRAFTS_PER_HOUR = 10;

export const VOICE_DRAFT_TOOL_NAMES = [
  "prepare_knowledge_draft", "save_knowledge_draft", "discard_knowledge_draft",
] as const;
export type VoiceDraftToolName = (typeof VOICE_DRAFT_TOOL_NAMES)[number];
export const isVoiceDraftTool = (name: string): name is VoiceDraftToolName =>
  (VOICE_DRAFT_TOOL_NAMES as readonly string[]).includes(name);

/** What the model sends to prepare_knowledge_draft. Same minimums as typed entries. */
export const voiceDraftInput = z.object({
  kind: z.enum(VOICE_DRAFT_KINDS),
  title: z.string().trim().min(2).max(VOICE_DRAFT_TITLE_MAX),
  body: z.string().trim().min(10).max(VOICE_DRAFT_BODY_MAX),
}).strict();
export type VoiceDraftInput = z.infer<typeof voiceDraftInput>;

/** Added to Sophie's instructions when voice drafts are enabled. Keep it short: the bridge caps instructions at 4,000 characters. */
export const OWNER_VOICE_DRAFT_INSTRUCTIONS = [
  "You can also save notes to the AI knowledge base, as unpublished drafts only.",
  "When the owner asks to add, remember or update something there:",
  "1) If a fact is missing or unclear (price, area, hours, conditions), ask one short question at a time.",
  "2) Call prepare_knowledge_draft with a short title and the text written as plain facts. It shows the note on the AI knowledge page and saves nothing.",
  "3) Read the title and text back exactly, mention any warnings, and ask: Should I save this as a draft?",
  "4) Only after a clear yes, call save_knowledge_draft with confirmed true. For changes, prepare again; for no, call discard_knowledge_draft.",
  "Never put customer names, phone numbers, emails, passwords or card details in a note.",
  "Say drafts are not used on calls until the owner reviews and publishes them on the AI knowledge page. You cannot publish, edit or delete entries.",
].join(" ");

/** Realtime tool definitions (JSON Schema). Offered only when voice drafts are enabled. */
export function voiceDraftSessionTools() {
  return [
    {
      type: "function",
      name: "prepare_knowledge_draft",
      description:
        "Show a proposed knowledge note on the owner's screen for review. Saves nothing. Use plain facts in the owner's words, " +
        "no customer details. Then read it back and ask whether to save it as a draft.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...VOICE_DRAFT_KINDS], description: "faq for a question callers ask, policy for a rule or fee, note for anything else" },
          title: { type: "string", description: "Short title, e.g. 'Call-out fee'" },
          body: { type: "string", description: `The note as plain facts, at most ${VOICE_DRAFT_BODY_MAX} characters` },
        },
        required: ["kind", "title", "body"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "save_knowledge_draft",
      description:
        "Save the note shown on screen as an unpublished draft. Call only after you read it back and the owner clearly said yes. " +
        "It is not used on calls until the owner publishes it.",
      parameters: {
        type: "object",
        properties: { confirmed: { type: "boolean", description: "true only when the owner clearly said yes to the read-back" } },
        required: ["confirmed"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "discard_knowledge_draft",
      description: "Remove the proposed note from the screen without saving it.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

/** Plain-language warnings shown on the draft card and read to the model before the read-back. */
export function voiceDraftWarnings(draft: Pick<VoiceDraftInput, "title" | "body">): string[] {
  const text = `${draft.title}\n${draft.body}`;
  const warnings: string[] = [];
  const flags = scanKnowledgeText(text);
  if (flags.includes("personal_data")) {
    warnings.push("It contains a phone number, email or long number. It will be held for review.");
  }
  if (flags.includes("instruction_like")) {
    warnings.push("It contains text that looks like instructions to the AI. It will be held for review.");
  }
  if (/\d/.test(text)) {
    warnings.push("Check every number, price and time. Voice can mishear them (for example 15 and 50).");
  }
  return warnings;
}

const AFFIRMATIVE = /^\W*(yes|yeah|yep|yup|sure|ok|okay|correct|right|that'?s right|go ahead|save it|please do|do it|sounds good)\b/i;
const NEGATIVE = /\b(no|nope|don'?t|do not|cancel|stop|wait|hold on|not yet|never mind)\b/i;

/**
 * The owner's answer to "Should I save this as a draft?", if it was transcribed.
 * A reply that starts with yes passes even if it says "no" later ("yes, no changes").
 * A reply with no/wait/cancel and no leading yes blocks the save.
 * An empty transcript (transcription unavailable) does not block on its own.
 */
export function ownerDeclined(transcript: string | null | undefined): boolean {
  const text = transcript?.trim() ?? "";
  if (!text) return false;
  return NEGATIVE.test(text) && !AFFIRMATIVE.test(text);
}

export type VoiceSaveCheck = {
  hasDraft: boolean;
  alreadySaved: boolean;
  /** The draft was prepared in this voice session (not left over from an earlier one). */
  sameSession: boolean;
  confirmed: unknown;
  /** Owner turns (speech the server committed) since the draft was shown. */
  ownerTurnsSinceShown: number;
  /** Transcript of the owner's latest turn since the draft was shown, if available. */
  latestOwnerReply: string | null;
  savedThisSession: number;
};

export type VoiceSaveDecision =
  | { ok: true }
  | { ok: false; status: "NO_DRAFT" | "ALREADY_SAVED" | "NOT_CONFIRMED" | "LIMIT_REACHED"; message: string };

/** Decides whether save_knowledge_draft may save. Pure so the guardrails are unit tested. */
export function checkVoiceSave(state: VoiceSaveCheck): VoiceSaveDecision {
  if (!state.hasDraft || !state.sameSession) {
    return { ok: false, status: "NO_DRAFT", message: "There is no note on screen. Call prepare_knowledge_draft first." };
  }
  if (state.alreadySaved) {
    return { ok: false, status: "ALREADY_SAVED", message: "This note is already saved as a draft. Do not save it again." };
  }
  if (state.savedThisSession >= VOICE_DRAFTS_PER_SESSION) {
    return { ok: false, status: "LIMIT_REACHED", message: "The voice draft limit for this session is reached. Ask the owner to add more on the AI knowledge page." };
  }
  if (state.confirmed !== true || state.ownerTurnsSinceShown < 1) {
    return { ok: false, status: "NOT_CONFIRMED", message: "Read the note back and ask the owner whether to save it. Save only after a clear yes." };
  }
  if (ownerDeclined(state.latestOwnerReply)) {
    return { ok: false, status: "NOT_CONFIRMED", message: "The owner did not clearly say yes. Ask whether to change it, save it, or discard it." };
  }
  return { ok: true };
}
