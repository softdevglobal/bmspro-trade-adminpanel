import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { EMAIL_SETTINGS_COLLECTION } from "../settings";
import { parseCompensationGuide, type CompensationEntry } from "./compensation-check";
import { describeReturnVisitPolicy, parseReturnVisitPolicy, type ReturnVisitPolicy } from "./return-visit-policy";

/**
 * The owner's return-visit rule and compensation guide, kept on `ai_email_settings/{businessId}`
 * (docs/sophie-email-learning-and-auto-reply.md §10.10, §16).
 *
 * The return-visit rule is saved as a new version each time it changes, and Sophie uses only the
 * version the owner approved in the app, never by voice. The compensation guide is only ever read to
 * show "your guide says $30 off" for one tap, so it needs no approval and gives no permission.
 */

export type StoredPolicies = {
  returnVisit: ReturnVisitPolicy | null;
  /** The version the owner approved; null until they do. */
  returnVisitApprovedVersion: number | null;
  /** The approved rule, or null when there's no rule or the latest version isn't approved yet. */
  approved: ReturnVisitPolicy | null;
  returnVisitText: string | null;
  compensation: { version: number; entries: CompensationEntry[] } | null;
};

export async function getPolicies(db: Firestore, businessId: string): Promise<StoredPolicies> {
  const data = (await db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId).get()).data() ?? {};
  const raw = data.returnVisitPolicy as (Omit<ReturnVisitPolicy, "version"> & { version?: unknown }) | undefined;
  const parsed = raw ? parseReturnVisitPolicy(raw) : null;
  const returnVisit: ReturnVisitPolicy | null = parsed?.ok && Number.isInteger(raw?.version) ? { ...parsed.policy, version: raw!.version as number } : null;
  const approvedVersion = Number.isInteger(data.returnVisitApprovedVersion) ? (data.returnVisitApprovedVersion as number) : null;
  const guideRaw = data.compensationGuide as { version?: unknown; entries?: unknown } | undefined;
  const guide = guideRaw ? parseCompensationGuide(guideRaw.entries) : null;
  return {
    returnVisit,
    returnVisitApprovedVersion: approvedVersion,
    approved: returnVisit && approvedVersion === returnVisit.version ? returnVisit : null,
    returnVisitText: returnVisit ? describeReturnVisitPolicy(returnVisit) : null,
    compensation: guide?.ok && Number.isInteger(guideRaw?.version) ? { version: guideRaw!.version as number, entries: guide.entries } : null,
  };
}

type Saved<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** Saves the rule as the next version. It's not used until the owner approves that exact version. */
export async function saveReturnVisitPolicy(db: Firestore, input: { businessId: string; policy: unknown; actorUid: string }, now = Date.now()): Promise<Saved<ReturnVisitPolicy>> {
  const parsed = parseReturnVisitPolicy(input.policy);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const ref = db.collection(EMAIL_SETTINGS_COLLECTION).doc(input.businessId);
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data()?.returnVisitPolicy as { version?: unknown } | undefined;
    const version = (Number.isInteger(current?.version) ? (current!.version as number) : 0) + 1;
    tx.set(ref, {
      returnVisitPolicy: { ...parsed.policy, version },
      returnVisitApprovedVersion: null,
      returnVisitSavedBy: input.actorUid,
      returnVisitSavedAt: Timestamp.fromMillis(now),
    }, { merge: true });
    return { ok: true as const, value: { ...parsed.policy, version } };
  });
}

/** The owner approves the exact version they were shown. Never by voice, never by Sophie. */
export async function approveReturnVisitPolicy(db: Firestore, input: { businessId: string; version: number; actorUid: string }, now = Date.now()): Promise<Saved<number>> {
  const ref = db.collection(EMAIL_SETTINGS_COLLECTION).doc(input.businessId);
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data()?.returnVisitPolicy as { version?: unknown } | undefined;
    if (!current || current.version !== input.version) return { ok: false as const, status: 409, error: "This rule changed since you opened it. Look at it again." };
    tx.set(ref, { returnVisitApprovedVersion: input.version, returnVisitApprovedBy: input.actorUid, returnVisitApprovedAt: Timestamp.fromMillis(now) }, { merge: true });
    return { ok: true as const, value: input.version };
  });
}

/** Withdraws the approval: Sophie stops offering until the owner approves again. */
export async function withdrawReturnVisitPolicy(db: Firestore, businessId: string): Promise<void> {
  await db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId).set({ returnVisitApprovedVersion: null }, { merge: true });
}

export async function saveCompensationGuide(db: Firestore, input: { businessId: string; entries: unknown; actorUid: string }, now = Date.now()): Promise<Saved<CompensationEntry[]>> {
  const parsed = parseCompensationGuide(input.entries);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const ref = db.collection(EMAIL_SETTINGS_COLLECTION).doc(input.businessId);
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data()?.compensationGuide as { version?: unknown } | undefined;
    const version = (Number.isInteger(current?.version) ? (current!.version as number) : 0) + 1;
    tx.set(ref, { compensationGuide: { version, entries: parsed.entries }, compensationSavedBy: input.actorUid, compensationSavedAt: Timestamp.fromMillis(now) }, { merge: true });
    return { ok: true as const, value: parsed.entries };
  });
}

export async function clearCompensationGuide(db: Firestore, businessId: string): Promise<void> {
  const { FieldValue } = await import("firebase-admin/firestore");
  await db.collection(EMAIL_SETTINGS_COLLECTION).doc(businessId).set({ compensationGuide: FieldValue.delete() }, { merge: true });
}
