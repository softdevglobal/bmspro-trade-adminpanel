import { scanKnowledgeText } from "@/lib/ai/learning/redact";

/**
 * Sophie's voice in email (docs/sophie-email-learning-and-auto-reply.md §8.5): the owner's greeting
 * and sign-off. Pure. Stored on `ai_email_settings/{businessId}` as `style`; until the owner saves
 * their own, Sophie uses the plain default. Learning it from the owner's sent email comes later
 * (step 8b); the owner always approves it.
 *
 * Sophie never signs as the owner: the signature line is fixed in templates.ts and always says she
 * is an AI assistant.
 */

export type EmailStyle = {
  /** With an optional {firstName}: "Hi {firstName},". */
  greeting: string;
  /** For someone whose name Sophie doesn't know for sure: "Hi there,". */
  greetingUnknown: string;
  /** "Cheers,". */
  signOff: string;
  /** Bumped on every saved change. */
  version: number;
  /** False for the built-in default. */
  ownerApproved: boolean;
  updatedAt: number | null;
};

export const DEFAULT_STYLE: EmailStyle = {
  greeting: "Hi {firstName},",
  greetingUnknown: "Hi there,",
  signOff: "Kind regards,",
  version: 0,
  ownerApproved: false,
  updatedAt: null,
};

const LINE = /^[\p{L}\p{N} ,.'!’&-]{2,40}$/u;

export function mapStyle(raw: unknown): EmailStyle {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (key: "greeting" | "greetingUnknown" | "signOff") => {
    const value = data[key];
    return typeof value === "string" && checkStyleLine(key, value) === null ? value : DEFAULT_STYLE[key];
  };
  return {
    greeting: pick("greeting"),
    greetingUnknown: pick("greetingUnknown"),
    signOff: pick("signOff"),
    version: Number.isInteger(data.version) ? Number(data.version) : 0,
    ownerApproved: data.ownerApproved === true,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : null,
  };
}

/** Null when the line is fine, otherwise why not, for the owner. */
export function checkStyleLine(key: "greeting" | "greetingUnknown" | "signOff", value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  const slots = text.match(/\{[^}]*\}/g) ?? [];
  if (key === "greeting" && slots.some((slot) => slot !== "{firstName}")) return "The greeting can only use {firstName}.";
  if (key !== "greeting" && slots.length > 0) return "This line can't use a name.";
  const plain = text.replace(/\{firstName\}/g, "Sam");
  if (!LINE.test(plain)) return "Use 2 to 40 letters, numbers and simple punctuation.";
  if (scanKnowledgeText(plain).length > 0) return "Leave out contact details and instructions.";
  return null;
}

/** "Hi Priya," or "Hi there,". */
export function greetingFor(style: EmailStyle, firstName: string | null): string {
  if (!style.greeting.includes("{firstName}")) return style.greeting;
  return firstName ? style.greeting.replace(/\{firstName\}/g, firstName) : style.greetingUnknown;
}
