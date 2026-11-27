import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { EMAIL_OUTBOX_COLLECTION } from "@/lib/email-integration/config";
import { splitQuoted } from "@/lib/email-integration/mailbox/compose";

import { checkStyleLine, type EmailStyle } from "./style";

/**
 * Learning how the owner writes (docs/sophie-email-learning-and-auto-reply.md §8.5): from the emails
 * a person at the business sends, Sophie keeps ONLY the greeting line and the sign-off line, as a
 * pattern ("Hi {firstName},", "Cheers,"), and counts them. No name, no sentence and nothing else of
 * the email is kept. After enough emails she suggests the usual ones, and the owner approves or
 * not: it never changes by itself.
 */

export const STYLE_SAMPLES_COLLECTION = "ai_email_style_samples";
/** Emails to learn from before suggesting anything. */
export const STYLE_SAMPLES_NEEDED = 10;
/** After "Not now", ask again only after this many more emails. */
export const STYLE_REASK_AFTER = 20;
const MAX_KEPT = 8;

const GREETING = /^(hi|hello|hey|dear|g'day|gday|good morning|good afternoon)(?:\s+([\p{L}][\p{L}'’-]{0,29}))?[,!]?$/iu;
const NOT_NAMES = new Set(["there", "all", "team", "everyone", "folks", "guys", "sir", "madam", "customer"]);
export const SIGN_OFF = /^(cheers|thanks|thank you|many thanks|kind regards|warm regards|best regards|regards|best|best wishes|sincerely|yours sincerely|talk soon|see you then)\s*[,!.]?$/i;

/** "Hi Priya," → { greeting: "Hi {firstName}," }; "Hi there," → { unknown: "Hi there," }; else null. */
export function readGreeting(line: string): { greeting?: string; unknown?: string } | null {
  const text = line.replace(/\s+/g, " ").trim();
  if (text.length > 40) return null;
  const match = GREETING.exec(text);
  if (!match) return null;
  const word = match[1];
  const opener = word[0].toUpperCase() + word.slice(1).toLowerCase();
  const name = match[2];
  // "Hi," or "Hi there," read as they are; a real name becomes the slot.
  const comma = /,$/.test(text) ? "," : "";
  const pattern = !name || NOT_NAMES.has(name.toLowerCase())
    ? { unknown: `${opener}${name ? ` ${name.toLowerCase()}` : ""}${comma}` }
    : { greeting: `${opener} {firstName}${comma}` };
  const checked = pattern.greeting ? checkStyleLine("greeting", pattern.greeting) : checkStyleLine("greetingUnknown", pattern.unknown!);
  return checked === null ? pattern : null;
}

/** The last sign-off line of what the owner wrote, as they wrote it. */
export function readSignOff(body: string): string | null {
  const lines = splitQuoted(body.replace(/\r\n/g, "\n")).written.split("\n").map((line) => line.trim()).filter(Boolean);
  // The sign-off sits just above the name or signature: look at the last few lines only.
  for (const line of lines.slice(-6).reverse()) {
    if (!SIGN_OFF.test(line)) continue;
    const text = line.replace(/\s+/g, " ").replace(/[.!]$/, ",");
    const normal = /[,]$/.test(text) ? text : `${text},`;
    const cased = normal[0].toUpperCase() + normal.slice(1);
    return checkStyleLine("signOff", cased) === null ? cased : null;
  }
  return null;
}

type Counted = { text: string; count: number };

function bump(list: Counted[], text: string | undefined): Counted[] {
  if (!text) return list;
  const next = list.some((item) => item.text === text)
    ? list.map((item) => (item.text === text ? { ...item, count: item.count + 1 } : item))
    : [...list, { text, count: 1 }];
  return next.sort((a, b) => b.count - a.count).slice(0, MAX_KEPT);
}

const counted = (value: unknown): Counted[] => (Array.isArray(value) ? value : [])
  .filter((item): item is Counted => !!item && typeof item.text === "string" && Number.isInteger(item.count))
  .slice(0, MAX_KEPT);

/** The `email.sent_by_owner` handler: learn from one email the owner (or their staff) sent. */
export async function learnFromSentEmail(db: Firestore, businessId: string, outboxId: string, now = Date.now()): Promise<string> {
  const outboxRef = db.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId);
  const item = (await outboxRef.get()).data();
  if (!item || item.businessId !== businessId) return "outbox_missing";
  // Her own mail, and the platform's standard quote and invoice emails, aren't the owner's words.
  if (item.origin === "agent" || item.kind !== "message" || item.intent === "forward") return "not_owner_words";
  const body = String((item.payloadSnapshot as { bodyText?: unknown } | undefined)?.bodyText ?? "");
  const firstLine = splitQuoted(body.replace(/\r\n/g, "\n")).written.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const greeting = readGreeting(firstLine);
  const signOff = readSignOff(body);
  if (!greeting && !signOff) return "no_style_found";

  const ref = db.collection(STYLE_SAMPLES_COLLECTION).doc(businessId);
  return db.runTransaction(async (tx) => {
    const [itemSnap, snap] = [await tx.get(outboxRef), await tx.get(ref)];
    if (itemSnap.data()?.styleLearned === true) return "already_learned";
    const data = snap.data() ?? {};
    tx.set(ref, {
      businessId,
      samples: (Number(data.samples) || 0) + 1,
      greetings: bump(counted(data.greetings), greeting?.greeting),
      unknownGreetings: bump(counted(data.unknownGreetings), greeting?.unknown),
      signOffs: bump(counted(data.signOffs), signOff ?? undefined),
      dismissedAtSamples: Number(data.dismissedAtSamples) || 0,
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    tx.set(outboxRef, { styleLearned: true }, { merge: true });
    return "learned";
  });
}

export type StyleSuggestion = {
  greeting: string;
  greetingUnknown: string;
  signOff: string;
  /** How many of the owner's emails it comes from. */
  samples: number;
};

/**
 * The usual greeting and sign-off, once there are enough emails, and only when they differ from
 * what Sophie uses now. Null otherwise, or after "Not now" until more emails have come in.
 */
export async function styleSuggestion(db: Firestore, businessId: string, current: EmailStyle): Promise<StyleSuggestion | null> {
  const data = (await db.collection(STYLE_SAMPLES_COLLECTION).doc(businessId).get()).data();
  if (!data || data.businessId !== businessId) return null;
  const samples = Number(data.samples) || 0;
  const dismissed = Number(data.dismissedAtSamples) || 0;
  if (samples < STYLE_SAMPLES_NEEDED || (dismissed > 0 && samples < dismissed + STYLE_REASK_AFTER)) return null;
  const top = (value: unknown) => counted(value)[0]?.text;
  const suggestion = {
    greeting: top(data.greetings) ?? current.greeting,
    greetingUnknown: top(data.unknownGreetings) ?? current.greetingUnknown,
    signOff: top(data.signOffs) ?? current.signOff,
    samples,
  };
  const same = suggestion.greeting === current.greeting && suggestion.greetingUnknown === current.greetingUnknown && suggestion.signOff === current.signOff;
  return same ? null : suggestion;
}

/** "Not now": ask again only after more emails. */
export async function dismissStyleSuggestion(db: Firestore, businessId: string): Promise<void> {
  const ref = db.collection(STYLE_SAMPLES_COLLECTION).doc(businessId);
  const data = (await ref.get()).data();
  if (!data || data.businessId !== businessId) return;
  await ref.set({ dismissedAtSamples: Number(data.samples) || 0 }, { merge: true });
}
