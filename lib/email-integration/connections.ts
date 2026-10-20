import "server-only";

import {
  EMAIL_CONNECTIONS_COLLECTION,
  EMAIL_CREDENTIALS_COLLECTION,
  EMAIL_MESSAGES_COLLECTION,
  EMAIL_OAUTH_STATE_TTL_MS,
  EMAIL_OAUTH_STATES_COLLECTION,
  EMAIL_OUTBOX_COLLECTION,
  EMAIL_SYNC_STATE_COLLECTION,
} from "@/lib/email-integration/config";
import { decryptJson, encryptJson } from "@/lib/email-integration/crypto";
import { recordEmailEvent } from "@/lib/email-integration/events";
import { capabilitiesFromScopes } from "@/lib/email-integration/scopes";
import { getEmailAdapter } from "@/lib/email-integration/providers";
import type {
  ConnectedAccount,
  ProviderCredentials,
} from "@/lib/email-integration/providers/types";
import type {
  EmailConnectionStatus,
  EmailConnectionSummary,
  EmailProvider,
} from "@/lib/email-integration/types";
import { adminDb } from "@/lib/firebase/admin";
import { createHash, randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";

/** Full connection record for server use. Still never includes credentials. */
export type EmailConnectionRecord = EmailConnectionSummary & {
  businessId: string;
  providerAccountId: string;
  grantedScopes: string[];
  credentialRef: string | null;
  generation: number;
};

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const STATUSES: EmailConnectionStatus[] = ["active", "needs_reconnect", "disconnected"];

export function mapConnectionDoc(id: string, data: DocumentData): EmailConnectionRecord {
  return {
    id,
    businessId: asString(data.businessId) ?? "",
    provider:
      data.provider === "microsoft" || data.provider === "yahoo" || data.provider === "imap"
        ? data.provider
        : "google",
    providerAccountId: asString(data.providerAccountId) ?? "",
    address: asString(data.address) ?? "",
    displayName: asString(data.displayName),
    capabilities: Array.isArray(data.capabilities)
      ? data.capabilities.filter((item): item is string => typeof item === "string")
      : [],
    grantedScopes: Array.isArray(data.grantedScopes)
      ? data.grantedScopes.filter((item): item is string => typeof item === "string")
      : [],
    status: STATUSES.includes(data.status) ? data.status : "disconnected",
    credentialRef: asString(data.credentialRef),
    generation: typeof data.generation === "number" ? data.generation : 1,
    connectedAt: toMillis(data.connectedAt),
    lastErrorCode: asString(data.lastErrorCode),
  };
}

export function toConnectionSummary(
  record: EmailConnectionRecord,
): EmailConnectionSummary {
  return {
    id: record.id,
    provider: record.provider,
    address: record.address,
    displayName: record.displayName,
    capabilities: record.capabilities,
    status: record.status,
    connectedAt: record.connectedAt,
    lastErrorCode: record.lastErrorCode,
  };
}

/** The business's current (not disconnected) sender — one per business in Stage 1. */
export async function getBusinessEmailConnection(
  businessId: string,
): Promise<EmailConnectionRecord | null> {
  const snap = await adminDb
    .collection(EMAIL_CONNECTIONS_COLLECTION)
    .where("businessId", "==", businessId)
    .where("status", "in", ["active", "needs_reconnect"])
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? mapConnectionDoc(doc.id, doc.data()) : null;
}

/** Loads a connection only when it belongs to the given business. */
export async function getEmailConnectionById(
  businessId: string,
  connectionId: string,
): Promise<EmailConnectionRecord | null> {
  if (!connectionId.trim() || connectionId.includes("/")) return null;
  const snap = await adminDb
    .collection(EMAIL_CONNECTIONS_COLLECTION)
    .doc(connectionId.trim())
    .get();
  if (!snap.exists) return null;
  const record = mapConnectionDoc(snap.id, snap.data() ?? {});
  return record.businessId === businessId ? record : null;
}

function connectionDocId(
  businessId: string,
  provider: EmailProvider,
  providerAccountId: string,
): string {
  const accountHash = createHash("sha256")
    .update(`${provider}:${providerAccountId}`)
    .digest("hex")
    .slice(0, 20);
  return `${businessId}_${provider}_${accountHash}`;
}

// ---- OAuth state -----------------------------------------------------------

/** Pages that can start the connect flow; the callback returns to the same one. */
export type OAuthReturnTo = "emails" | "settings";

export function parseReturnTo(value: unknown): OAuthReturnTo {
  return value === "settings" ? "settings" : "emails";
}

export type OAuthStateRecord = {
  uid: string;
  businessId: string;
  provider: EmailProvider;
  codeVerifier: string;
  returnTo: OAuthReturnTo;
  /** True when this authorisation asks for read access as well as send. */
  enableInbox: boolean;
};

/** Creates a single-use, short-lived OAuth state bound to user and business. */
export async function createOAuthState(
  input: Omit<OAuthStateRecord, "codeVerifier">,
): Promise<{ state: string; codeChallenge: string }> {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  await adminDb
    .collection(EMAIL_OAUTH_STATES_COLLECTION)
    .doc(createHash("sha256").update(state).digest("hex"))
    .create({
      ...input,
      codeVerifier,
      expiresAt: Timestamp.fromMillis(Date.now() + EMAIL_OAUTH_STATE_TTL_MS),
      createdAt: FieldValue.serverTimestamp(),
    });
  return { state, codeChallenge };
}

/** Deletes the state as it is read, so a callback can only be used once. */
export async function consumeOAuthState(
  state: string,
  provider: EmailProvider,
): Promise<OAuthStateRecord | null> {
  if (!state || state.length > 200) return null;
  const ref = adminDb
    .collection(EMAIL_OAUTH_STATES_COLLECTION)
    .doc(createHash("sha256").update(state).digest("hex"));
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    const data = snap.data() ?? {};
    const expiresAt = toMillis(data.expiresAt) ?? 0;
    if (
      expiresAt < Date.now() ||
      data.provider !== provider ||
      typeof data.uid !== "string" ||
      typeof data.businessId !== "string" ||
      typeof data.codeVerifier !== "string"
    ) {
      return null;
    }
    return {
      uid: data.uid,
      businessId: data.businessId,
      provider,
      codeVerifier: data.codeVerifier,
      returnTo: parseReturnTo(data.returnTo),
      enableInbox: data.enableInbox === true,
    };
  });
}

// ---- Connect / credentials / disconnect ------------------------------------

export class EmailConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Stores a newly authorised mailbox. Reconnecting the same account keeps its
 * generation; a different account is refused while another one is connected.
 */
export async function saveConnectedAccount(input: {
  businessId: string;
  uid: string;
  provider: EmailProvider;
  account: ConnectedAccount;
}): Promise<EmailConnectionRecord> {
  const { businessId, uid, provider, account } = input;
  const existing = await getBusinessEmailConnection(businessId);
  if (
    existing &&
    (existing.provider !== provider ||
      existing.providerAccountId !== account.providerAccountId)
  ) {
    throw new EmailConnectionError(
      "account_mismatch",
      `${existing.address} is already connected. Disconnect it before connecting a different mailbox.`,
    );
  }

  const id = connectionDocId(businessId, provider, account.providerAccountId);
  const ref = adminDb.collection(EMAIL_CONNECTIONS_COLLECTION).doc(id);
  const credentialRef = adminDb.collection(EMAIL_CREDENTIALS_COLLECTION).doc(id);
  const sealed = encryptJson(account.credentials);

  const wasKnown = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();
    tx.set(credentialRef, { businessId, sealed, updatedAt: now });
    tx.set(
      ref,
      {
        businessId,
        provider,
        providerAccountId: account.providerAccountId,
        address: account.address,
        displayName: account.displayName,
        capabilities: capabilitiesFromScopes(account.grantedScopes),
        grantedScopes: account.grantedScopes,
        status: "active",
        credentialRef: id,
        generation: snap.exists ? (snap.data()?.generation ?? 1) : 1,
        isDefault: true,
        lastErrorCode: null,
        createdBy: snap.exists ? (snap.data()?.createdBy ?? uid) : uid,
        connectedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return snap.exists;
  });

  await recordEmailEvent({
    businessId,
    eventType: wasKnown ? "reconnected" : "connected",
    connectionId: id,
    actorId: uid,
  });

  const saved = await getEmailConnectionById(businessId, id);
  if (!saved) {
    throw new EmailConnectionError("save_failed", "Could not save the connection.");
  }
  return saved;
}

export async function loadCredentials(
  connection: EmailConnectionRecord,
): Promise<ProviderCredentials | null> {
  if (!connection.credentialRef) return null;
  const snap = await adminDb
    .collection(EMAIL_CREDENTIALS_COLLECTION)
    .doc(connection.credentialRef)
    .get();
  const sealed = snap.data()?.sealed;
  if (typeof sealed !== "string" || snap.data()?.businessId !== connection.businessId) {
    return null;
  }
  return decryptJson<ProviderCredentials>(sealed);
}

export async function storeCredentials(
  connection: EmailConnectionRecord,
  credentials: ProviderCredentials,
): Promise<void> {
  if (!connection.credentialRef) return;
  await adminDb
    .collection(EMAIL_CREDENTIALS_COLLECTION)
    .doc(connection.credentialRef)
    .set(
      { sealed: encryptJson(credentials), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

export async function markConnectionNeedsReconnect(
  connection: EmailConnectionRecord,
  code: string,
): Promise<void> {
  await adminDb.collection(EMAIL_CONNECTIONS_COLLECTION).doc(connection.id).update({
    status: "needs_reconnect",
    lastErrorCode: code,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await recordEmailEvent({
    businessId: connection.businessId,
    eventType: "needs_reconnect",
    connectionId: connection.id,
    safeErrorDetail: code,
  });
}

/** Deletes every synced message and the sync cursor for a mailbox. */
export async function purgeSyncedMailbox(connectionId: string): Promise<void> {
  const col = adminDb.collection(EMAIL_MESSAGES_COLLECTION);
  for (;;) {
    const snap = await col.where("connectionId", "==", connectionId).limit(400).get();
    if (snap.empty) break;
    const batch = adminDb.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
  await adminDb.collection(EMAIL_SYNC_STATE_COLLECTION).doc(connectionId).delete();
}

/**
 * Disables sending, bumps the generation so nothing queued can go out through
 * a later connection, holds pending work, revokes the grant and deletes the
 * stored credentials.
 */
export async function disconnectEmailConnection(
  connection: EmailConnectionRecord,
  uid: string,
): Promise<void> {
  const credentials = await loadCredentials(connection).catch(() => null);

  await adminDb.collection(EMAIL_CONNECTIONS_COLLECTION).doc(connection.id).update({
    status: "disconnected",
    generation: FieldValue.increment(1),
    credentialRef: null,
    isDefault: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (credentials) {
    await getEmailAdapter(connection.provider)?.revoke(credentials);
  }
  if (connection.credentialRef) {
    await adminDb
      .collection(EMAIL_CREDENTIALS_COLLECTION)
      .doc(connection.credentialRef)
      .delete();
  }

  const pending = await adminDb
    .collection(EMAIL_OUTBOX_COLLECTION)
    .where("connectionId", "==", connection.id)
    .where("status", "in", ["queued", "retry_wait"])
    .get();
  for (const doc of pending.docs) {
    await doc.ref.update({
      status: "held",
      errorCode: "connection_disconnected",
      safeErrorDetail: "The mailbox was disconnected before this email was sent.",
      leaseUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await recordEmailEvent({
      businessId: connection.businessId,
      eventType: "held",
      outboxId: doc.id,
      connectionId: connection.id,
      actorId: uid,
      safeErrorDetail: "connection_disconnected",
    });
  }

  // Synced mail is a cache of the owner's mailbox: remove it with the connection.
  await purgeSyncedMailbox(connection.id);

  await recordEmailEvent({
    businessId: connection.businessId,
    eventType: "disconnected",
    connectionId: connection.id,
    actorId: uid,
  });
}
