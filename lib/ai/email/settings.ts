import "server-only";

import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";

import { agentFlags } from "@/lib/ai/agent/config";

import { KINDS_ALWAYS_ON } from "./labels";
import { checkStyleLine, mapStyle, type EmailStyle } from "./style";

/**
 * Sophie's email settings for one business (`ai_email_settings/{businessId}`) and the platform
 * switches (docs/sophie-email-learning-and-auto-reply.md §14.4, §16). Later steps add the style
 * guide, the summary time and folder names to the same document.
 */

export const EMAIL_SETTINGS_COLLECTION = "ai_email_settings";

/** `AI_EMAIL_TRIAGE_ENABLED`, under the platform switch `AI_AGENT_ENABLED`. Both default to off. */
export function emailTriageAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return agentFlags(env).enabled && env.AI_EMAIL_TRIAGE_ENABLED?.trim() === "true";
}

/** `AI_EMAIL_AUTO_ENABLED`: approved rules may act alone (not replies). Off by default (§14.4). */
export function emailAutoEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return emailTriageAvailable(env) && env.AI_EMAIL_AUTO_ENABLED?.trim() === "true";
}

/** `AI_EMAIL_AUTO_REPLY_ENABLED`: an approved rule may also send template replies (step 8 pilot). Off by default. */
export function emailAutoReplyEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return emailAutoEnabled(env) && env.AI_EMAIL_AUTO_REPLY_ENABLED?.trim() === "true";
}

/** `AI_EMAIL_COMPLAINTS_ENABLED`: Sophie may open complaint cases from the owner's answers (step 9). Off by default. */
export function emailComplaintsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return emailTriageAvailable(env) && env.AI_EMAIL_COMPLAINTS_ENABLED?.trim() === "true";
}

/** `AI_STAFF_QUESTIONS_ENABLED`: Sophie may ask the technician what happened, in the staff app (step 9). Off by default. */
export function staffQuestionsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return emailComplaintsEnabled(env) && env.AI_STAFF_QUESTIONS_ENABLED?.trim() === "true";
}

/**
 * `AI_EMAIL_TRIAGE_DRY_RUN`: shadow mode. Sophie sorts and logs, and cards say "Here's what I would
 * have done", but nothing is acted on. On unless set to exactly "false".
 */
export function emailTriageDryRun(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.AI_EMAIL_TRIAGE_DRY_RUN?.trim() !== "false";
}

export type EmailSettings = {
  /** "Sophie sorts new email". Off by default. */
  enabled: boolean;
  /** When it was last switched on. Only mail that arrives after this is sorted (§4.1, T01). */
  enabledAt: number | null;
  /** Pause stops every action not yet done, at once. Sorting carries on; the policy check blocks acting. */
  paused: boolean;
  pausedAt: number | null;
  /** Local hour (0–23) of the daily summary, in the business time zone. Default 5 pm (§16). */
  summaryHour: number;
  /** The local date (YYYY-MM-DD) of the last daily summary, so it goes once a day (T18). */
  lastSummaryDate: string | null;
  lastSummaryAt: number | null;
  /** Types the owner switched off (§5.1, §16): Sophie leaves them in the inbox and never asks. */
  kindsOff: string[];
  /** Sophie's greeting and sign-off in replies (§8.5). */
  style: EmailStyle;
  /** The safety reply version the owner approved (§10.5); null until they do. */
  safetyReplyVersion: number | null;
};

export const DEFAULT_SUMMARY_HOUR = 17;

export const canTurnKindOff = (kind: string) =>
  !KINDS_ALWAYS_ON.includes(kind) && (/^[a-z_]{2,40}$/.test(kind) || /^custom:[a-z0-9_]{1,40}$/.test(kind));

const toMillis = (value: unknown): number | null => (value instanceof Timestamp ? value.toMillis() : null);

export function mapEmailSettings(data: DocumentData | undefined): EmailSettings {
  const enabledAt = toMillis(data?.enabledAt);
  const hour = data?.summaryHour;
  return {
    enabled: data?.enabled === true && enabledAt !== null,
    enabledAt,
    paused: data?.paused === true,
    pausedAt: toMillis(data?.pausedAt),
    summaryHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_SUMMARY_HOUR,
    lastSummaryDate: typeof data?.lastSummaryDate === "string" ? data.lastSummaryDate : null,
    lastSummaryAt: toMillis(data?.lastSummaryAt),
    style: mapStyle(data?.style),
    safetyReplyVersion: Number.isInteger(data?.safetyReplyVersion) ? data!.safetyReplyVersion : null,
    kindsOff: Array.isArray(data?.kindsOff) ? data.kindsOff.filter((kind: unknown): kind is string => typeof kind === "string").slice(0, 50) : [],
  };
}

export async function getEmailSettings(db: Firestore, businessId: string): Promise<EmailSettings> {
  return mapEmailSettings((await db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId).get()).data());
}

/** New mail received at or after this time is sorted. Null when sorting is off for this business. */
export function triageCutoff(settings: EmailSettings): number | null {
  return settings.enabled ? settings.enabledAt : null;
}

/** The cutoff for one business, or null without a read when the platform switches are off. */
export async function emailTriageCutoff(
  db: Firestore,
  businessId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number | null> {
  if (!emailTriageAvailable(env)) return null;
  return triageCutoff(await getEmailSettings(db, businessId));
}

/**
 * Turns sorting on or off, or pauses. Switching on stamps `enabledAt`; switching on again while it
 * is already on keeps the old stamp, so a double tap never moves the cutoff. Switching off and on
 * again starts a new cutoff: mail that arrived while it was off is never sorted.
 */
export async function updateEmailSettings(
  db: Firestore,
  businessId: string,
  patch: {
    enabled?: boolean;
    paused?: boolean;
    summaryHour?: number;
    kindOff?: { kind: string; off: boolean };
    /** Checked with checkStyleLine first; a bad line is ignored here. */
    style?: { greeting: string; greetingUnknown: string; signOff: string };
    /** Approve the exact safety reply shown (its version), or withdraw it with null. */
    safetyReplyVersion?: number | null;
  },
  actorUid: string,
  now = Date.now(),
): Promise<EmailSettings> {
  const ref = db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId);
  return db.runTransaction(async (tx) => {
    const current = mapEmailSettings((await tx.get(ref)).data());
    const next: EmailSettings = { ...current };
    if (patch.enabled === true && !current.enabled) {
      next.enabled = true;
      next.enabledAt = now;
    } else if (patch.enabled === false) {
      next.enabled = false;
    }
    if (patch.paused === true && !current.paused) {
      next.paused = true;
      next.pausedAt = now;
    } else if (patch.paused === false) {
      next.paused = false;
      next.pausedAt = null;
    }
    if (patch.summaryHour !== undefined && Number.isInteger(patch.summaryHour) && patch.summaryHour >= 0 && patch.summaryHour <= 23) {
      next.summaryHour = patch.summaryHour;
    }
    if (patch.kindOff && (canTurnKindOff(patch.kindOff.kind) || !patch.kindOff.off)) {
      const others = next.kindsOff.filter((kind) => kind !== patch.kindOff!.kind);
      next.kindsOff = patch.kindOff.off ? [...others, patch.kindOff.kind] : others;
    }
    if (patch.style && (["greeting", "greetingUnknown", "signOff"] as const).every((key) => checkStyleLine(key, patch.style![key]) === null)) {
      const tidy = (value: string) => value.replace(/\s+/g, " ").trim();
      next.style = {
        greeting: tidy(patch.style.greeting),
        greetingUnknown: tidy(patch.style.greetingUnknown),
        signOff: tidy(patch.style.signOff),
        version: current.style.version + 1,
        ownerApproved: true,
        updatedAt: now,
      };
    }
    if (patch.safetyReplyVersion !== undefined) {
      next.safetyReplyVersion = patch.safetyReplyVersion === null || Number.isInteger(patch.safetyReplyVersion) ? patch.safetyReplyVersion : current.safetyReplyVersion;
    }
    const stamp = (value: number | null) => (value === null ? null : Timestamp.fromMillis(value));
    tx.set(ref, {
      businessId,
      enabled: next.enabled,
      enabledAt: stamp(next.enabledAt),
      paused: next.paused,
      pausedAt: stamp(next.pausedAt),
      summaryHour: next.summaryHour,
      kindsOff: next.kindsOff,
      ...(next.style !== current.style ? { style: next.style } : {}),
      ...(next.safetyReplyVersion !== current.safetyReplyVersion
        ? { safetyReplyVersion: next.safetyReplyVersion, safetyReplyApprovedAt: next.safetyReplyVersion === null ? null : Timestamp.fromMillis(now), safetyReplyApprovedBy: actorUid }
        : {}),
      updatedBy: actorUid,
      updatedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    return next;
  });
}
