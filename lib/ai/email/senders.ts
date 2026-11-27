import "server-only";

import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";

import type { BlockedSender } from "./precheck";

/**
 * The owner's private and blocked sender lists (docs/sophie-email-learning-and-auto-reply.md §4.1,
 * §11.3, §16). Stored hashed per business: the doc id is a hash of the business and the address,
 * and only a masked form ("ja***@gmail.com") and the owner's own label are kept for display.
 *
 * - Private: Sophie never sends the email to the AI, never summarises it, learns from it or replies.
 * - Blocked: filed in the owner's folder without Sophie reading it.
 */

export const PRIVATE_SENDERS_COLLECTION = "ai_email_private_senders";
export const BLOCKED_SENDERS_COLLECTION = "ai_email_blocked_senders";
export const MAX_SENDERS_PER_LIST = 200;
export const DEFAULT_BLOCKED_FOLDER = "Blocked";

export type SenderList = "private" | "blocked";

export type SenderEntry = {
  key: string;
  list: SenderList;
  kind: "address" | "domain";
  /** "ja***@gmail.com", or "@domain" for a blocked domain. */
  display: string;
  label: string | null;
  /** Blocked senders only. */
  folder: string | null;
  source: "settings" | "card";
  addedAt: number | null;
};

const collectionFor = (list: SenderList) => (list === "private" ? PRIVATE_SENDERS_COLLECTION : BLOCKED_SENDERS_COLLECTION);
const toMillis = (value: unknown) => (value instanceof Timestamp ? value.toMillis() : null);

const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@([a-z0-9-]+\.)+[a-z]{2,}$/;
const DOMAIN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const FOLDER = /^[\p{L}\p{N} _-]{1,40}$/u;

/** Blocking one of these would block thousands of people. Block the single address instead. */
export const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "yahoo.com.au", "icloud.com", "me.com", "aol.com", "bigpond.com", "bigpond.net.au", "optusnet.com.au",
  "proton.me", "protonmail.com", "gmx.com", "zoho.com",
]);

/** An address ("sam@x.com") or a domain ("@x.com" or "x.com"), lowercased; null when neither. */
export function parseSenderValue(raw: unknown): { kind: "address" | "domain"; value: string } | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (text.length > 254) return null;
  if (ADDRESS.test(text)) return { kind: "address", value: text };
  const domain = text.replace(/^@/, "");
  return DOMAIN.test(domain) ? { kind: "domain", value: `@${domain}` } : null;
}

/** The lookup key. Domains are stored as "@domain", which no address can equal. */
export function senderKey(businessId: string, value: string): string {
  return createHash("sha256").update(`${businessId}\n${value}`).digest("hex").slice(0, 40);
}

export function maskSender(value: string): string {
  if (value.startsWith("@")) return value;
  const [local, domain] = value.split("@");
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}***@${domain}`;
}

const cleanLabel = (raw: unknown) =>
  typeof raw === "string" && raw.trim() ? raw.replace(/\s+/g, " ").trim().slice(0, 60) : null;

type AddResult = { ok: true; entry: SenderEntry } | { ok: false; status: number; error: string };

/** Adds or updates one entry. Adding the same sender again only updates its label or folder. */
export async function addSender(
  db: Firestore,
  businessId: string,
  input: { list: SenderList; value: unknown; label?: unknown; folder?: unknown; source?: "settings" | "card" },
  actorUid: string,
  now = Date.now(),
): Promise<AddResult> {
  const parsed = parseSenderValue(input.value);
  if (!parsed) return { ok: false, status: 400, error: "Enter an email address, or @domain to block a whole domain." };
  if (input.list === "private" && parsed.kind === "domain") {
    return { ok: false, status: 400, error: "Private senders are single email addresses." };
  }
  if (parsed.kind === "domain" && SHARED_MAIL_DOMAINS.has(parsed.value.slice(1))) {
    return { ok: false, status: 400, error: `Blocking ${parsed.value} would block everyone who uses it. Block the address instead.` };
  }
  let folder: string | null = null;
  if (input.list === "blocked") {
    folder = input.folder === undefined || input.folder === null || input.folder === ""
      ? DEFAULT_BLOCKED_FOLDER
      : typeof input.folder === "string" && FOLDER.test(input.folder.trim()) ? input.folder.trim() : null;
    if (!folder) return { ok: false, status: 400, error: "Folder names are up to 40 letters, numbers, spaces, - or _." };
  }

  const collection = db.collection(collectionFor(input.list));
  const key = senderKey(businessId, parsed.value);
  const existing = await collection.doc(key).get();
  if (!existing.exists) {
    const count = (await collection.where("businessId", "==", businessId).limit(MAX_SENDERS_PER_LIST).get()).docs.length;
    if (count >= MAX_SENDERS_PER_LIST) {
      return { ok: false, status: 409, error: `This list is full (${MAX_SENDERS_PER_LIST}). Remove someone first.` };
    }
  }
  const entry: SenderEntry = {
    key,
    list: input.list,
    kind: parsed.kind,
    display: maskSender(parsed.value),
    label: cleanLabel(input.label),
    folder,
    source: input.source ?? "settings",
    addedAt: existing.exists ? toMillis(existing.data()?.addedAt) : now,
  };
  await collection.doc(key).set({
    businessId,
    kind: entry.kind,
    display: entry.display,
    label: entry.label,
    folder: entry.folder,
    source: entry.source,
    addedBy: actorUid,
    addedAt: Timestamp.fromMillis(entry.addedAt ?? now),
    updatedAt: Timestamp.fromMillis(now),
  });
  return { ok: true, entry };
}

/** Removes one entry. False when it doesn't exist or belongs to another business. */
export async function removeSender(db: Firestore, businessId: string, list: SenderList, key: string): Promise<boolean> {
  if (!/^[0-9a-f]{40}$/.test(key)) return false;
  const ref = db.collection(collectionFor(list)).doc(key);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) return false;
  await ref.delete();
  return true;
}

export async function listSenders(db: Firestore, businessId: string): Promise<Record<SenderList, SenderEntry[]>> {
  const read = async (list: SenderList) => {
    const snap = await db.collection(collectionFor(list)).where("businessId", "==", businessId).limit(MAX_SENDERS_PER_LIST).get();
    return snap.docs.map((doc): SenderEntry => {
      const data = doc.data() ?? {};
      return {
        key: doc.id,
        list,
        kind: data.kind === "domain" ? "domain" : "address",
        display: typeof data.display === "string" ? data.display : "",
        label: typeof data.label === "string" ? data.label : null,
        folder: typeof data.folder === "string" ? data.folder : null,
        source: data.source === "card" ? "card" : "settings",
        addedAt: toMillis(data.addedAt),
      };
    }).sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  };
  const [privateSenders, blockedSenders] = await Promise.all([read("private"), read("blocked")]);
  return { private: privateSenders, blocked: blockedSenders };
}

/**
 * The pre-check's view of one sender: is the address private, and is the address or its domain
 * blocked? A blocked address wins over its domain. Three reads, by key.
 */
export async function lookupSender(
  db: Firestore,
  businessId: string,
  address: string,
): Promise<{ private: boolean; blocked: BlockedSender | null }> {
  const parsed = parseSenderValue(address);
  if (!parsed || parsed.kind !== "address") return { private: false, blocked: null };
  const domain = `@${parsed.value.split("@")[1]}`;
  const read = (list: SenderList, value: string) =>
    db.collection(collectionFor(list)).doc(senderKey(businessId, value)).get();
  const [privateSnap, addressSnap, domainSnap] = await Promise.all([
    read("private", parsed.value),
    read("blocked", parsed.value),
    read("blocked", domain),
  ]);
  const ours = (snap: Awaited<ReturnType<typeof read>>) => snap.exists && snap.data()?.businessId === businessId;
  const blockedSnap = ours(addressSnap) ? addressSnap : ours(domainSnap) ? domainSnap : null;
  const folder = blockedSnap?.data()?.folder;
  return {
    private: ours(privateSnap),
    blocked: blockedSnap
      ? { kind: blockedSnap === addressSnap ? "address" : "domain", folder: typeof folder === "string" ? folder : DEFAULT_BLOCKED_FOLDER }
      : null,
  };
}
