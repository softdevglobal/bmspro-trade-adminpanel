import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { scanKnowledgeText } from "@/lib/ai/learning/redact";

import { actionsKey, parseActions } from "./action-list";
import { BUILT_IN_KIND_OPTIONS, type EmailKindOption } from "./classify";
import { needsDetails } from "./details";
import { emailKindLabel } from "./labels";
import type { EmailAction, EmailKind } from "./types";

/**
 * The owner's own email types (docs/sophie-email-learning-and-auto-reply.md §4.3, §6.3, step 7b):
 * "Council letters", "Strata notices". `ai_email_kinds/{businessId}_{slug}`, one per type.
 *
 * The description goes into the classifier's instructions, so it is short, one line, and refused
 * when it reads like instructions to an AI. The default actions come from the fixed list only.
 */

export const EMAIL_KINDS_COLLECTION = "ai_email_kinds";
export const MAX_CUSTOM_KINDS = 30;

export type CustomKind = {
  kind: EmailKind;
  label: string;
  description: string;
  /** What Sophie suggests for this type. Never a customer or request: those need a single email's details. */
  actions: EmailAction[];
  createdAt: number | null;
};

const SLUG = /^[a-z0-9_]{1,40}$/;

/** "Council letters" → "council_letters". Null when nothing is left. */
export function kindSlug(name: string): string | null {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/, "");
  return slug && SLUG.test(slug) ? slug : null;
}

const docId = (businessId: string, slug: string) => `${businessId}_${slug}`;
const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : null);
const BUILT_IN = new Set<string>(BUILT_IN_KIND_OPTIONS.map((option) => option.kind));

export async function listCustomKinds(db: Firestore, businessId: string): Promise<CustomKind[]> {
  const snap = await db.collection(EMAIL_KINDS_COLLECTION).where("businessId", "==", businessId).limit(MAX_CUSTOM_KINDS * 2).get();
  return snap.docs
    .map((doc) => doc.data())
    .filter((data) => data.businessId === businessId && data.active !== false && typeof data.slug === "string" && SLUG.test(data.slug))
    .map((data): CustomKind => ({
      kind: `custom:${data.slug}`,
      label: emailKindLabel(`custom:${data.slug}`),
      description: typeof data.description === "string" ? data.description : "",
      actions: parseActions(data.actions) ?? [{ kind: "notify_owner", urgency: "routine" }],
      createdAt: toMillis(data.createdAt),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The classifier's list: the built-in types, then the owner's own. */
export async function classifierKinds(db: Firestore, businessId: string): Promise<{ options: EmailKindOption[]; custom: CustomKind[] }> {
  const custom = await listCustomKinds(db, businessId);
  return {
    options: [...BUILT_IN_KIND_OPTIONS, ...custom.map((kind) => ({ kind: kind.kind, description: kind.description }))],
    custom,
  };
}

/** The types an owner can pick on a card or for a group: never private (its own button) or system. */
export async function pickableKinds(db: Firestore, businessId: string): Promise<{ kind: string; label: string }[]> {
  const custom = await listCustomKinds(db, businessId);
  return [
    ...BUILT_IN_KIND_OPTIONS.filter((option) => option.kind !== "private" && option.kind !== "system")
      .map((option) => ({ kind: option.kind as string, label: emailKindLabel(option.kind) })),
    ...custom.map((kind) => ({ kind: kind.kind as string, label: kind.label })),
  ];
}

/** Every type the owner may confirm, and what each of the owner's own types suggests. */
export async function kindChoices(db: Firestore, businessId: string): Promise<{ kinds: Set<string>; defaults: Map<string, EmailAction[]> }> {
  const custom = await listCustomKinds(db, businessId);
  return {
    kinds: new Set([...BUILT_IN, ...custom.map((kind) => kind.kind)]),
    defaults: new Map(custom.map((kind) => [kind.kind as string, kind.actions])),
  };
}

type AddResult = { ok: true; kind: CustomKind; created: boolean } | { ok: false; status: number; error: string };

/** Adds a type, or updates its description and actions when one with the same name exists. */
export async function addCustomKind(
  db: Firestore,
  businessId: string,
  input: { name: unknown; description: unknown; actions: unknown },
  actorUid: string,
  now = Date.now(),
): Promise<AddResult> {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > 40) return { ok: false, status: 400, error: "Give the type a name of 2 to 40 characters." };
  const slug = kindSlug(name);
  if (!slug) return { ok: false, status: 400, error: "Use letters and numbers in the name." };
  if (BUILT_IN.has(slug) || BUILT_IN_KIND_OPTIONS.some((option) => emailKindLabel(option.kind).toLowerCase() === name.toLowerCase())) {
    return { ok: false, status: 409, error: "Sophie already has a type with that name." };
  }
  const description = typeof input.description === "string" ? input.description.replace(/\s+/g, " ").trim() : "";
  if (description.length < 5 || description.length > 160) return { ok: false, status: 400, error: "Describe these emails in 5 to 160 characters, e.g. “letters from the council about permits”." };
  if (scanKnowledgeText(description).length > 0) {
    return { ok: false, status: 400, error: "Describe what the emails are about, without email addresses, phone numbers or instructions." };
  }
  const actions = parseActions(input.actions);
  if (!actions || actions.length === 0) return { ok: false, status: 400, error: "Choose what Sophie should suggest for these emails." };
  if (needsDetails(actions.map((action) => action.kind))) {
    return { ok: false, status: 400, error: "Saving customers and adding requests need one email's details, so they can't be a type's default." };
  }

  const ref = db.collection(EMAIL_KINDS_COLLECTION).doc(docId(businessId, slug));
  const existing = await ref.get();
  if (!existing.exists || existing.data()?.active === false) {
    const count = (await listCustomKinds(db, businessId)).length;
    if (count >= MAX_CUSTOM_KINDS) return { ok: false, status: 409, error: `You have ${MAX_CUSTOM_KINDS} types already. Remove one first.` };
  }
  const createdAt = existing.exists && existing.data()?.active !== false ? toMillis(existing.data()?.createdAt) ?? now : now;
  await ref.set({
    businessId,
    slug,
    description,
    actions,
    actionsKey: actionsKey(actions),
    active: true,
    createdBy: existing.exists ? existing.data()?.createdBy ?? actorUid : actorUid,
    createdAt: Timestamp.fromMillis(createdAt),
    updatedBy: actorUid,
    updatedAt: Timestamp.fromMillis(now),
  });
  return {
    ok: true,
    created: !existing.exists || existing.data()?.active === false,
    kind: { kind: `custom:${slug}`, label: emailKindLabel(`custom:${slug}`), description, actions, createdAt },
  };
}

/** Sophie stops using the type. Past decisions keep it; rules for it never match again. */
export async function removeCustomKind(db: Firestore, businessId: string, kind: string, now = Date.now()): Promise<boolean> {
  const slug = kind.startsWith("custom:") ? kind.slice("custom:".length) : "";
  if (!SLUG.test(slug)) return false;
  const ref = db.collection(EMAIL_KINDS_COLLECTION).doc(docId(businessId, slug));
  const data = (await ref.get()).data();
  if (!data || data.businessId !== businessId || data.active === false) return false;
  await ref.set({ active: false, updatedAt: Timestamp.fromMillis(now) }, { merge: true });
  return true;
}
