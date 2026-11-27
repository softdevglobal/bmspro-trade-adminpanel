import "server-only";

import { createHash } from "node:crypto";
import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";

import { actionLabel } from "./action-list";
import { EMAIL_DECISIONS_COLLECTION, EMAIL_RULES_COLLECTION, EMAIL_TRIAGE_COLLECTION } from "./collections";
import { sameDecisionsRun } from "./decisions";
import { emailKindLabel } from "./labels";
import { maskSender, senderKey, SHARED_MAIL_DOMAINS } from "./senders";
import type { EmailAction, EmailActionKind, EmailKind, EmailRiskFlag, EmailTriageResult, ExampleHit } from "./types";
import { EMAIL_RISK_FLAGS } from "./types";

export { EMAIL_RULES_COLLECTION };

/**
 * How Sophie learns to act alone (docs/sophie-email-learning-and-auto-reply.md §5). After the same
 * owner answer N times in a row she offers the narrowest rule that covers them; the owner approves
 * that exact version; an Undo, a "Wrong" spot check or the review date send it back to asking.
 *
 * Memory helps Sophie guess. Only an approved rule gives her permission, and a rule can only pick
 * from the fixed action list. Counting is a plain database query, never RAG.
 */

/** §5.3: same answers in a row before an offer, by action. The largest of a rule's actions applies. */
const OFFER_AFTER: Partial<Record<EmailActionKind, number>> = {
  move_folder: 3,
  mark_read: 3,
  ignore: 3,
  notify_owner: 3,
  link_thread: 5,
  add_bill_item: 5,
  pause_reminders: 5,
  add_calendar_reminder: 5,
  // An email can't be unsent (plan §4.5).
  reply: 10,
  resend_document: 10,
  // Never in a rule: saving a customer and adding requests need details the owner confirms (step 6b).
};

/** Types that always go to the owner, whatever they answered before. */
const NEVER_RULE_KINDS: readonly string[] = ["private", "system", "unknown", "suspicious", "complaint"];

export const REVIEW_AFTER_MS = 90 * 24 * 60 * 60_000;
/** What the owner may pick when editing an offer (§5.4). Never longer than the default. */
export const REVIEW_DAY_CHOICES: readonly number[] = [30, 60, 90];
export const CONFIDENCE_CHOICES: readonly number[] = [0.85, 0.9, 0.95];
export const DEFAULT_MIN_CONFIDENCE = 0.85;
/** "Sophie guessed right": of the owner's last 20 answers for the type, her guess matched at least 95%. */
const ACCURACY_NEEDED = 0.95;
const ACCURACY_WINDOW = 20;
/** Of the 5 nearest past emails, at least this many must be this rule's type and actions. */
export const RULE_AGREEMENT_NEEDED = 3;
/** One automatic action in every 20 appears in the daily summary as "Check one of mine" (§5.5). */
export const SPOT_CHECK_EVERY = 20;

export type RuleScope =
  | { kind: "sender"; senderKey: string; label: string }
  | { kind: "domain"; domain: string }
  | { kind: "any" };

export type RuleStatus = "offered" | "approved" | "declined" | "demoted";

export type EmailRule = {
  id: string;
  businessId: string;
  kind: EmailKind;
  /** Each offer and renewal is a new exact version; the owner approves one version. */
  version: number;
  level: "off" | "suggest" | "auto";
  status: RuleStatus;
  scope: RuleScope;
  customer: "known" | "new" | "any";
  minConfidence: number;
  requireAgreement: boolean;
  exceptFlags: EmailRiskFlag[];
  actions: EmailAction[];
  actionsKey: string;
  basedOnDecisionIds: string[];
  /** Why it's asking again, in a sentence for the owner. */
  reason: string | null;
  approvedBy: string | null;
  approvedAt: number | null;
  reviewAt: number | null;
  /** How long an approval lasts before Sophie asks again: 30, 60 or 90 days (the owner's choice when editing the offer). */
  reviewDays: number;
  statusAt: number;
  stats: { autoCount: number; undoCount: number; lastUndoAt: number | null };
};

const toMillis = (value: unknown): number | null =>
  value instanceof Timestamp ? value.toMillis() : typeof value === "number" && Number.isFinite(value) ? value : null;

export function mapRule(id: string, data: DocumentData): EmailRule {
  const stats = (data.stats ?? {}) as Record<string, unknown>;
  return {
    id,
    businessId: String(data.businessId ?? ""),
    kind: String(data.kind ?? "unknown") as EmailKind,
    version: Number(data.version) || 1,
    level: data.level === "auto" || data.level === "off" ? data.level : "suggest",
    status: ["offered", "approved", "declined", "demoted"].includes(data.status) ? data.status : "offered",
    scope: (data.scope ?? { kind: "any" }) as RuleScope,
    customer: data.customer === "known" || data.customer === "new" ? data.customer : "any",
    minConfidence: typeof data.minConfidence === "number" ? data.minConfidence : DEFAULT_MIN_CONFIDENCE,
    requireAgreement: data.requireAgreement !== false,
    exceptFlags: Array.isArray(data.exceptFlags) ? data.exceptFlags : [...EMAIL_RISK_FLAGS],
    actions: Array.isArray(data.actions) ? data.actions : [],
    actionsKey: String(data.actionsKey ?? ""),
    basedOnDecisionIds: Array.isArray(data.basedOnDecisionIds) ? data.basedOnDecisionIds : [],
    reason: typeof data.reason === "string" ? data.reason : null,
    approvedBy: typeof data.approvedBy === "string" ? data.approvedBy : null,
    approvedAt: toMillis(data.approvedAt),
    reviewAt: toMillis(data.reviewAt),
    reviewDays: REVIEW_DAY_CHOICES.includes(Number(data.reviewDays)) ? Number(data.reviewDays) : 90,
    statusAt: toMillis(data.statusAt) ?? 0,
    stats: { autoCount: Number(stats.autoCount) || 0, undoCount: Number(stats.undoCount) || 0, lastUndoAt: toMillis(stats.lastUndoAt) },
  };
}

/** N for these actions, or null when they can't be a rule. */
export function offerThreshold(actions: readonly EmailAction[]): number | null {
  if (actions.length === 0) return null;
  let threshold = 0;
  for (const action of actions) {
    const n = OFFER_AFTER[action.kind];
    if (!n) return null;
    threshold = Math.max(threshold, n);
  }
  return threshold;
}

const scopeKey = (scope: RuleScope) => scope.kind === "sender" ? `sender:${scope.senderKey}` : scope.kind === "domain" ? `domain:${scope.domain}` : "any";

export function ruleIdFor(businessId: string, kind: string, actionsKey: string, scope: RuleScope): string {
  return createHash("sha256").update([businessId, kind, actionsKey, scopeKey(scope)].join("\n")).digest("hex").slice(0, 40);
}

const KNOWN = new Set(["verified_sender", "verified_thread", "contact_match"]);

/** The narrowest scope covering these emails (§5.6): one sender, one company domain, or anyone. */
export function narrowestScope(businessId: string, senders: { address: string | null; identity: string | null }[]): { scope: RuleScope; customer: EmailRule["customer"] } {
  const addresses = senders.map((sender) => sender.address?.toLowerCase() ?? "");
  const customer = senders.every((sender) => KNOWN.has(sender.identity ?? "")) ? "known"
    : senders.every((sender) => !sender.identity || sender.identity === "none") ? "new" : "any";
  if (addresses.length > 0 && addresses.every((address) => address && address === addresses[0])) {
    return { scope: { kind: "sender", senderKey: senderKey(businessId, addresses[0]), label: maskSender(addresses[0]) }, customer };
  }
  const domains = addresses.map((address) => address.split("@")[1] ?? "");
  if (domains[0] && domains.every((domain) => domain === domains[0]) && !SHARED_MAIL_DOMAINS.has(domains[0])) {
    return { scope: { kind: "domain", domain: domains[0] }, customer };
  }
  return { scope: { kind: "any" }, customer };
}

function ruleRecord(rule: Omit<EmailRule, "id">, now: number): DocumentData {
  return {
    ...rule,
    approvedAt: rule.approvedAt === null ? null : Timestamp.fromMillis(rule.approvedAt),
    reviewAt: rule.reviewAt === null ? null : Timestamp.fromMillis(rule.reviewAt),
    statusAt: Timestamp.fromMillis(rule.statusAt),
    stats: { ...rule.stats, lastUndoAt: rule.stats.lastUndoAt === null ? null : Timestamp.fromMillis(rule.stats.lastUndoAt) },
    updatedAt: Timestamp.fromMillis(now),
  };
}

/**
 * After an owner answer: offer a rule when the same answer came N times in a row and Sophie's guesses
 * for the type have been right (§5.3). Returns the offered rule, or null. A declined or demoted rule
 * is offered again only after N new same answers.
 */
export async function offerRuleAfterDecision(
  db: Firestore,
  decision: { businessId: string; confirmedKind: EmailKind; actions: EmailAction[]; actionsKey: string; via: string },
  now = Date.now(),
): Promise<EmailRule | null> {
  if (decision.via === "rule" || NEVER_RULE_KINDS.includes(decision.confirmedKind)) return null;
  const threshold = offerThreshold(decision.actions);
  if (!threshold) return null;
  // Any sender: the scope is worked out from who sent them.
  const like = { confirmedKind: decision.confirmedKind, actionsKey: decision.actionsKey };
  const run = (await sameDecisionsRun(db, decision.businessId, like, threshold)).slice(0, threshold);
  if (run.length < threshold) return null;

  // Sophie guessed right: her type matched the owner's in at least 95% of the last 20 answers.
  const lastAnswers = await db.collection(EMAIL_DECISIONS_COLLECTION)
    .where("businessId", "==", decision.businessId)
    .where("confirmedKind", "==", decision.confirmedKind)
    .orderBy("decidedAt", "desc")
    .limit(ACCURACY_WINDOW * 2)
    .get();
  const owners = lastAnswers.docs.map((doc) => doc.data()).filter((data) => data.via !== "rule").slice(0, ACCURACY_WINDOW);
  const right = owners.filter((data) => data.guessedKind === decision.confirmedKind).length;
  if (owners.length === 0 || right / owners.length < ACCURACY_NEEDED) return null;

  const rows = await Promise.all(run.map((item) => db.collection(EMAIL_TRIAGE_COLLECTION).doc(item.id).get()));
  const senders = rows.map((snap) => {
    const data = snap.data() ?? {};
    return { address: (data.sender as { address?: string } | null)?.address ?? null, identity: typeof data.identity === "string" ? data.identity : null };
  });
  const { scope, customer } = narrowestScope(decision.businessId, senders);
  const id = ruleIdFor(decision.businessId, decision.confirmedKind, decision.actionsKey, scope);
  const ref = db.collection(EMAIL_RULES_COLLECTION).doc(id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? mapRule(snap.id, snap.data() ?? {}) : null;
    if (existing && (existing.status === "offered" || existing.status === "approved")) return null;
    if (existing && existing.level === "off") return null;
    // Asked again only after N new same answers since "Keep asking me" or a demotion.
    if (existing && !run.every((item) => item.decidedAt > existing.statusAt)) return null;
    const rule: Omit<EmailRule, "id"> = {
      businessId: decision.businessId,
      kind: decision.confirmedKind,
      version: (existing?.version ?? 0) + 1,
      level: "suggest",
      status: "offered",
      scope,
      customer,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
      requireAgreement: true,
      exceptFlags: [...EMAIL_RISK_FLAGS],
      actions: decision.actions,
      actionsKey: decision.actionsKey,
      basedOnDecisionIds: run.map((item) => item.id),
      reason: null,
      approvedBy: null,
      approvedAt: null,
      reviewAt: null,
      reviewDays: existing?.reviewDays ?? 90,
      statusAt: now,
      stats: existing?.stats ?? { autoCount: 0, undoCount: 0, lastUndoAt: null },
    };
    tx.set(ref, { ...ruleRecord(rule, now), ...(existing ? {} : { createdAt: Timestamp.fromMillis(now) }) });
    return { id, ...rule };
  });
}

type Change = { ok: true; rule: EmailRule } | { ok: false; status: number; error: string };

async function change(
  db: Firestore,
  businessId: string,
  ruleId: string,
  update: (rule: EmailRule) => Partial<Omit<EmailRule, "id">> | string,
  now: number,
): Promise<Change> {
  if (!/^[0-9a-f]{40}$/.test(ruleId)) return { ok: false, status: 404, error: "Rule not found." };
  const ref = db.collection(EMAIL_RULES_COLLECTION).doc(ruleId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || !data || data.businessId !== businessId) return { ok: false as const, status: 404, error: "Rule not found." };
    const rule = mapRule(snap.id, data);
    const patch = update(rule);
    if (typeof patch === "string") return { ok: false as const, status: 409, error: patch };
    const next: EmailRule = { ...rule, ...patch };
    const record: Omit<EmailRule, "id"> & { id?: string } = { ...next };
    delete record.id;
    tx.set(ref, ruleRecord(record, now), { merge: true });
    return { ok: true as const, rule: next };
  });
}

/** The owner approves the exact version they were shown (§5.4, playbook O01). Never by voice. */
export function approveRule(db: Firestore, input: { businessId: string; ruleId: string; version: number; actorUid: string }, now = Date.now()) {
  return change(db, input.businessId, input.ruleId, (rule) => {
    if (rule.status !== "offered") return "This rule isn't waiting for approval.";
    if (rule.version !== input.version) return "This offer changed since you opened it. Look at it again.";
    return { status: "approved", level: "auto", approvedBy: input.actorUid, approvedAt: now, reviewAt: now + rule.reviewDays * 24 * 60 * 60_000, reason: null, statusAt: now };
  }, now);
}

/**
 * "Edit" on an offer (§5.4): how sure Sophie must be (85, 90 or 95%), and how soon she asks again
 * (30, 60 or 90 days). Both can only make her stricter than the default. The offer becomes the next
 * exact version, which is the one the owner then approves. Nothing about WHAT she does can change here.
 */
export function editOffer(
  db: Firestore,
  input: { businessId: string; ruleId: string; version: number; minConfidence?: number; reviewDays?: number },
  now = Date.now(),
) {
  return change(db, input.businessId, input.ruleId, (rule) => {
    if (rule.status !== "offered") return "This rule isn't waiting for approval.";
    if (rule.version !== input.version) return "This offer changed since you opened it. Look at it again.";
    if (input.minConfidence !== undefined && !CONFIDENCE_CHOICES.includes(input.minConfidence)) return "Choose 85%, 90% or 95%.";
    if (input.reviewDays !== undefined && !REVIEW_DAY_CHOICES.includes(input.reviewDays)) return "Choose 30, 60 or 90 days.";
    return {
      version: rule.version + 1,
      minConfidence: input.minConfidence ?? rule.minConfidence,
      reviewDays: input.reviewDays ?? rule.reviewDays,
      statusAt: now,
    };
  }, now);
}

/** "Keep asking me". */
export function declineRule(db: Firestore, input: { businessId: string; ruleId: string; version: number }, now = Date.now()) {
  return change(db, input.businessId, input.ruleId, (rule) => {
    if (rule.status !== "offered" || rule.version !== input.version) return "This offer changed since you opened it.";
    return { status: "declined", level: "suggest", reason: "You asked me to keep asking.", statusAt: now };
  }, now);
}

/**
 * Moving a rule down never needs a confirmation: "ask me first" or "off". Moving up to automatic
 * only happens by approving an exact version.
 */
export function setRuleLevel(db: Firestore, input: { businessId: string; ruleId: string; level: "suggest" | "off" }, now = Date.now()) {
  return change(db, input.businessId, input.ruleId, (rule) => {
    // An approved rule moved down is no longer approved: getting back to automatic means a new offer.
    const status = rule.status === "approved" ? "demoted" : rule.status;
    if (input.level === "off") return { level: "off", status, reason: "You turned it off.", statusAt: now };
    if (rule.level === "auto") return { level: "suggest", status, reason: "You asked me to ask first.", statusAt: now };
    return { level: "suggest", status, reason: null, statusAt: now };
  }, now);
}

/** Back to asking after an Undo or a "Wrong" spot check (§5.5, T07). */
export function demoteRule(db: Firestore, input: { businessId: string; ruleId: string; reason: string; undo: boolean }, now = Date.now()) {
  return change(db, input.businessId, input.ruleId, (rule) => ({
    level: rule.level === "off" ? "off" : "suggest",
    status: rule.status === "approved" ? "demoted" : rule.status,
    reason: input.reason,
    statusAt: now,
    stats: input.undo ? { ...rule.stats, undoCount: rule.stats.undoCount + 1, lastUndoAt: now } : rule.stats,
  }), now);
}

export async function listRules(db: Firestore, businessId: string): Promise<EmailRule[]> {
  const snap = await db.collection(EMAIL_RULES_COLLECTION).where("businessId", "==", businessId).limit(200).get();
  return snap.docs
    .map((doc) => mapRule(doc.id, doc.data() ?? {}))
    .filter((rule) => rule.businessId === businessId)
    .sort((a, b) => b.statusAt - a.statusAt);
}

/** What the owner sees for a rule: in the offer, and in Settings → Sophie → Email rules. */
export type RuleView = {
  id: string;
  version: number;
  kind: EmailKind;
  kindLabel: string;
  level: EmailRule["level"];
  status: RuleStatus;
  /** "Promotions from anyone at acme.com (new senders only)". */
  scopeLabel: string;
  actions: { action: EmailAction; label: string }[];
  /** "Promotions from anyone: Move to Advertising, then Mark as read." */
  sentence: string;
  reason: string | null;
  basedOn: number;
  approvedAt: number | null;
  reviewAt: number | null;
  autoCount: number;
  undoCount: number;
  minConfidence: number;
  reviewDays: number;
};

export function ruleView(rule: EmailRule): RuleView {
  const who = rule.scope.kind === "sender" ? `from ${rule.scope.label}`
    : rule.scope.kind === "domain" ? `from anyone at ${rule.scope.domain}` : "from anyone";
  const customer = rule.customer === "known" ? " (saved customers only)" : rule.customer === "new" ? " (new senders only)" : "";
  const scopeLabel = `${emailKindLabel(rule.kind)} ${who}${customer}`;
  const actions = rule.actions.map((action) => ({ action, label: actionLabel(action) }));
  return {
    id: rule.id,
    version: rule.version,
    kind: rule.kind,
    kindLabel: emailKindLabel(rule.kind),
    level: rule.level,
    status: rule.status,
    scopeLabel,
    actions,
    sentence: `${scopeLabel}: ${actions.map((item, index) => (index === 0 ? item.label : item.label[0].toLowerCase() + item.label.slice(1))).join(", then ")}.`,
    reason: rule.reason,
    basedOn: rule.basedOnDecisionIds.length,
    approvedAt: rule.approvedAt,
    reviewAt: rule.reviewAt,
    autoCount: rule.stats.autoCount,
    undoCount: rule.stats.undoCount,
    minConfidence: rule.minConfidence,
    reviewDays: rule.reviewDays,
  };
}

export type RuleMatch =
  | { outcome: "auto"; rule: EmailRule }
  /** A rule fits but may not act alone: the card shows its actions, at this version (T08). */
  | { outcome: "suggest"; rule: EmailRule; reason: string | null }
  | { outcome: "none"; reason: string | null };

function scopeFits(scope: RuleScope, businessId: string, address: string): boolean {
  if (scope.kind === "any") return true;
  if (scope.kind === "sender") return scope.senderKey === senderKey(businessId, address);
  return address.split("@")[1] === scope.domain;
}

const SCOPE_ORDER: Record<RuleScope["kind"], number> = { sender: 0, domain: 1, any: 2 };

/**
 * The rule for one sorted email (§5.5, §5.6). It acts alone only when: approved and automatic, for
 * this sender and kind of customer, Sophie is sure enough (T16), similar past emails agree, no risk
 * flag, not a saved customer's promotion (T05), and no other rule disagrees. A rule past its review
 * date goes back to asking and is offered for renewal (T17).
 */
export async function matchRule(
  db: Firestore,
  input: {
    businessId: string;
    result: EmailTriageResult;
    codeFlags: EmailRiskFlag[];
    senderAddress: string;
    senderIsCustomer: boolean;
    identity: string | null;
    examples: readonly ExampleHit[];
  },
  now = Date.now(),
): Promise<RuleMatch> {
  const snap = await db.collection(EMAIL_RULES_COLLECTION)
    .where("businessId", "==", input.businessId)
    .where("kind", "==", input.result.kind)
    .limit(20)
    .get();
  const known = KNOWN.has(input.identity ?? "");
  const fits = snap.docs
    .map((doc) => mapRule(doc.id, doc.data() ?? {}))
    .filter((rule) => rule.businessId === input.businessId && rule.level !== "off")
    .filter((rule) => scopeFits(rule.scope, input.businessId, input.senderAddress))
    .filter((rule) => rule.customer === "any" || (rule.customer === "known") === known)
    .sort((a, b) => SCOPE_ORDER[a.scope.kind] - SCOPE_ORDER[b.scope.kind]);
  if (fits.length === 0) return { outcome: "none", reason: null };

  for (const [index, rule] of fits.entries()) {
    if (rule.status === "approved" && rule.reviewAt !== null && rule.reviewAt <= now) {
      // Renewal: the same rule is offered again as a new exact version.
      const renewed = await change(db, input.businessId, rule.id, (current) => ({
        status: "offered", level: "suggest", version: current.version + 1,
        reason: "It's been 90 days: check it's still right, and renew it.", statusAt: now,
      }), now);
      if (renewed.ok) fits[index] = renewed.rule;
    }
  }

  const flags = new Set([...input.result.flags, ...input.codeFlags]);
  const automatic = fits.filter((rule) => rule.status === "approved" && rule.level === "auto");
  const why = (rule: EmailRule): string | null => {
    if (input.result.kind === "promotion" && input.senderIsCustomer) return "It's from a saved customer, so I'm asking.";
    if (input.result.confidence < rule.minConfidence) return "I'm not sure enough about this one.";
    if (rule.exceptFlags.some((flag) => flags.has(flag))) return "Something in it needs you.";
    if (rule.requireAgreement) {
      const agree = input.examples.slice(0, 5).filter((hit) => hit.kind === rule.kind && hit.actionsKey === rule.actionsKey).length;
      if (agree < RULE_AGREEMENT_NEEDED) return "It isn't quite like the emails you taught me.";
    }
    return null;
  };
  // Two automatic rules that fit and say different things: the owner decides, whatever else agrees.
  if (new Set(automatic.map((rule) => rule.actionsKey)).size > 1) {
    return { outcome: "suggest", rule: automatic[0], reason: "Two of your rules disagree about this one." };
  }
  const eligible = automatic.filter((rule) => why(rule) === null);
  if (eligible.length > 0) return { outcome: "auto", rule: eligible[0] };
  const first = automatic[0] ?? fits[0];
  return { outcome: "suggest", rule: first, reason: automatic[0] ? why(automatic[0]) : first.reason };
}

/**
 * The decision Sophie makes alone under a rule, for the runner to carry out. One per email: a retry
 * finds the one already made. Returns whether this one is a spot check.
 */
export async function recordRuleDecision(
  db: Firestore,
  input: { businessId: string; triageId: string; messageId: string; rule: EmailRule; senderKey: string | null; guessedKind: EmailKind },
  now = Date.now(),
): Promise<{ created: boolean; spotCheck: boolean }> {
  const decisionRef = db.collection(EMAIL_DECISIONS_COLLECTION).doc(input.triageId);
  const ruleRef = db.collection(EMAIL_RULES_COLLECTION).doc(input.rule.id);
  return db.runTransaction(async (tx) => {
    const [decisionSnap, ruleSnap] = [await tx.get(decisionRef), await tx.get(ruleRef)];
    if (decisionSnap.exists) return { created: false, spotCheck: decisionSnap.data()?.spotCheck === true };
    const autoCount = (Number((ruleSnap.data()?.stats as Record<string, unknown> | undefined)?.autoCount) || 0) + 1;
    const spotCheck = autoCount % SPOT_CHECK_EVERY === 0;
    tx.set(decisionRef, {
      businessId: input.businessId,
      triageId: input.triageId,
      messageId: input.messageId,
      confirmedKind: input.rule.kind,
      guessedKind: input.guessedKind,
      actions: input.rule.actions,
      actionsKey: input.rule.actionsKey,
      replyEdited: false,
      matchedSuggestion: true,
      senderKey: input.senderKey,
      decidedBy: "sophie",
      via: "rule",
      ruleId: input.rule.id,
      ruleVersion: input.rule.version,
      actionsStatus: "pending",
      spotCheck,
      decidedAt: Timestamp.fromMillis(now),
    });
    tx.set(ruleRef, { stats: { autoCount } }, { merge: true });
    return { created: true, spotCheck };
  });
}

/** For a rule decision, at the moment of acting: is that exact rule still approved and automatic? */
export async function ruleStillActive(db: Firestore, businessId: string, ruleId: string, version: number): Promise<boolean> {
  const data = (await db.collection(EMAIL_RULES_COLLECTION).doc(ruleId).get()).data();
  return !!data && data.businessId === businessId && data.status === "approved" && data.level === "auto" && data.version === version;
}

/** A "Wrong" answer to a spot check counts as a correction (§5.5). */
export async function answerSpotCheck(
  db: Firestore,
  input: { businessId: string; triageId: string; verdict: "right" | "wrong" },
  now = Date.now(),
): Promise<{ ok: true; demoted: boolean } | { ok: false; status: number; error: string }> {
  if (!/^[0-9a-f]{40}$/.test(input.triageId)) return { ok: false, status: 404, error: "Not found." };
  const ref = db.collection(EMAIL_DECISIONS_COLLECTION).doc(input.triageId);
  const data = (await ref.get()).data();
  if (!data || data.businessId !== input.businessId || data.spotCheck !== true) return { ok: false, status: 404, error: "Not found." };
  if (data.spotCheckAnswer) return { ok: false, status: 409, error: "Already answered." };
  await ref.set({ spotCheckAnswer: input.verdict, spotCheckAnsweredAt: Timestamp.fromMillis(now), ...(input.verdict === "wrong" ? { undone: true } : {}) }, { merge: true });
  if (input.verdict === "right" || typeof data.ruleId !== "string") return { ok: true, demoted: false };
  await demoteRule(db, { businessId: input.businessId, ruleId: data.ruleId, reason: "You marked one of mine as wrong, so I'll ask you about these again.", undo: true }, now);
  return { ok: true, demoted: true };
}
