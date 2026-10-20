import "server-only";

import {
  EMAIL_BACKOFF_SECONDS,
  EMAIL_LEASE_MS,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_MAX_BODY_LENGTH,
  EMAIL_MAX_PDF_BYTES,
  EMAIL_MAX_RECIPIENTS,
  EMAIL_MAX_SUBJECT_LENGTH,
  EMAIL_OUTBOX_BATCH_SIZE,
  EMAIL_OUTBOX_COLLECTION,
  MAILBOX_ATTACHMENTS_MAX_BYTES,
  MAILBOX_ATTACHMENTS_MAX_FILES,
  isRecipientAllowed,
} from "@/lib/email-integration/config";
import {
  getEmailConnectionById,
  markConnectionNeedsReconnect,
  type EmailConnectionRecord,
} from "@/lib/email-integration/connections";
import { freshCredentials } from "@/lib/email-integration/credentials";
import {
  attachmentNameFor,
  documentSendBlocker,
  generateDocumentPdf,
  loadEmailableDocument,
} from "@/lib/email-integration/documents";
import { recordEmailEvent, type EmailEventType } from "@/lib/email-integration/events";
import { generateMessageId } from "@/lib/email-integration/mime";
import type { SendThread } from "@/lib/email-integration/providers/types";
import { getEmailAdapter } from "@/lib/email-integration/providers";
import type {
  EmailDocumentType,
  EmailOutboxStatus,
  EmailPayloadSnapshot,
  EmailSendHistoryItem,
} from "@/lib/email-integration/types";
import {
  adminAuth,
  adminDb,
  adminStorage,
  getStorageBucketName,
} from "@/lib/firebase/admin";
import { createHash, randomBytes } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";

export type OutboxError = { ok: false; status: number; error: string; code?: string };

const RETRYABLE_BY_STAFF: EmailOutboxStatus[] = ["failed", "held", "blocked_auth", "unknown"];
const SENDER_ROLES = new Set(["owner", "admin", "business_owner"]);

function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---- Validation ------------------------------------------------------------

const ADDRESS_PATTERN = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** Trims, validates and de-duplicates recipients, preserving the original case. */
export function normaliseRecipients(
  raw: unknown,
  field: string,
): { ok: true; value: string[] } | OutboxError {
  if (raw == null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, status: 400, error: `${field} must be a list of addresses.` };
  }
  const seen = new Set<string>();
  const value: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { ok: false, status: 400, error: `${field} must be a list of addresses.` };
    }
    const address = item.trim();
    if (!address) continue;
    if (address.length > 254 || !ADDRESS_PATTERN.test(address)) {
      return { ok: false, status: 422, error: `"${address}" is not a valid email address.` };
    }
    if (!isRecipientAllowed(address)) {
      return {
        ok: false,
        status: 422,
        error: `"${address}" is not on this environment's recipient allowlist.`,
      };
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    value.push(address);
  }
  return { ok: true, value };
}

function validateContent(
  subject: unknown,
  bodyText: unknown,
): { ok: true; subject: string; bodyText: string } | OutboxError {
  if (typeof subject !== "string" || !subject.trim()) {
    return { ok: false, status: 400, error: "Subject is required." };
  }
  if (/[\r\n]/.test(subject)) {
    return { ok: false, status: 400, error: "Subject must be a single line." };
  }
  if (subject.trim().length > EMAIL_MAX_SUBJECT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Subject must be ${EMAIL_MAX_SUBJECT_LENGTH} characters or less.`,
    };
  }
  if (typeof bodyText !== "string" || !bodyText.trim()) {
    return { ok: false, status: 400, error: "Message is required." };
  }
  if (bodyText.length > EMAIL_MAX_BODY_LENGTH) {
    return { ok: false, status: 400, error: "Message is too long." };
  }
  return { ok: true, subject: subject.trim(), bodyText: bodyText.replace(/\r\n/g, "\n") };
}

async function readActor(uid: string): Promise<{
  businessId: string | null;
  role: string | null;
  name: string | null;
}> {
  const snap = await adminDb.collection("users").doc(uid).get();
  const data = snap.data() ?? {};
  return {
    businessId: typeof data.businessId === "string" ? data.businessId : null,
    role: typeof data.role === "string" ? data.role : null,
    name: typeof data.fullName === "string" ? data.fullName.trim() || null : null,
  };
}

/**
 * Send-time permission recheck. Mirrors requireBusinessOwner, which trusts the
 * auth claims, and also blocks disabled accounts.
 */
async function actorCanSend(uid: string, businessId: string): Promise<boolean> {
  try {
    const user = await adminAuth.getUser(uid);
    if (user.disabled) return false;
    const claims = user.customClaims ?? {};
    if (typeof claims.businessId === "string" && typeof claims.role === "string") {
      return claims.businessId === businessId && SENDER_ROLES.has(claims.role);
    }
  } catch {
    return false;
  }
  const actor = await readActor(uid);
  return actor.businessId === businessId && SENDER_ROLES.has(actor.role ?? "");
}

// ---- Enqueue ---------------------------------------------------------------

type StoredOutbox = {
  outboxId: string;
  status: EmailOutboxStatus;
};

async function savePdf(businessId: string, outboxId: string, pdf: Buffer): Promise<string> {
  const key = `email-outbox/${businessId}/${outboxId}-${randomBytes(6).toString("hex")}.pdf`;
  await adminStorage
    .bucket(getStorageBucketName())
    .file(key)
    .save(pdf, {
      resumable: false,
      metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
    });
  return key;
}

async function deletePdf(key: string | null): Promise<void> {
  if (!key) return;
  await adminStorage
    .bucket(getStorageBucketName())
    .file(key)
    .delete({ ignoreNotFound: true })
    .catch(() => undefined);
}

/**
 * Creates the outbox item and its `queued` event in one transaction. The doc
 * id is derived from the idempotency key, so a repeated request returns the
 * original item and a reused key with different content is refused.
 */
async function createOutboxItem(
  outboxId: string,
  payloadHash: string,
  doc: Record<string, unknown>,
): Promise<{ ok: true; created: boolean; item: StoredOutbox } | OutboxError> {
  const ref = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() ?? {};
      if (data.payloadHash !== payloadHash) {
        return {
          ok: false as const,
          status: 409,
          error: "This send request was already used with different content.",
          code: "idempotency_conflict",
        };
      }
      return {
        ok: true as const,
        created: false,
        item: { outboxId, status: data.status as EmailOutboxStatus },
      };
    }
    const now = FieldValue.serverTimestamp();
    tx.create(ref, {
      ...doc,
      payloadHash,
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: Timestamp.now(),
      leaseUntil: null,
      providerMessageId: null,
      providerThreadId: null,
      errorCode: null,
      safeErrorDetail: null,
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await recordEmailEvent(
      {
        businessId: String(doc.businessId),
        eventType: "queued",
        outboxId,
        connectionId: String(doc.connectionId),
        actorId: String(doc.actorId),
      },
      tx,
    );
    return { ok: true as const, created: true, item: { outboxId, status: "queued" } };
  });
}

function outboxIdFor(businessId: string, idempotencyKey: string): string {
  return sha256(`${businessId}:${idempotencyKey}`).slice(0, 40);
}

export function parseIdempotencyKey(raw: string | null): string | null {
  const key = raw?.trim() ?? "";
  return /^[A-Za-z0-9_-]{16,100}$/.test(key) ? key : null;
}

export type EnqueueDocumentEmailInput = {
  businessId: string;
  actorId: string;
  idempotencyKey: string;
  connectionId: unknown;
  documentType: EmailDocumentType;
  documentId: string;
  documentVersion: unknown;
  to: unknown;
  cc: unknown;
  subject: unknown;
  bodyText: unknown;
};

export async function enqueueDocumentEmail(
  input: EnqueueDocumentEmailInput,
): Promise<{ ok: true; outboxId: string; status: EmailOutboxStatus; created: boolean } | OutboxError> {
  const to = normaliseRecipients(input.to, "To");
  if (!to.ok) return to;
  const cc = normaliseRecipients(input.cc, "CC");
  if (!cc.ok) return cc;
  if (to.value.length === 0) {
    return { ok: false, status: 422, error: "Add at least one recipient." };
  }
  if (to.value.length + cc.value.length > EMAIL_MAX_RECIPIENTS) {
    return {
      ok: false,
      status: 422,
      error: `Send to at most ${EMAIL_MAX_RECIPIENTS} recipients.`,
    };
  }
  const content = validateContent(input.subject, input.bodyText);
  if (!content.ok) return content;
  if (typeof input.connectionId !== "string" || typeof input.documentVersion !== "string") {
    return { ok: false, status: 400, error: "connection_id and document_version are required." };
  }

  const connection = await getEmailConnectionById(input.businessId, input.connectionId);
  if (!connection || connection.status === "disconnected") {
    return { ok: false, status: 404, error: "Email connection not found." };
  }
  if (connection.status !== "active") {
    return {
      ok: false,
      status: 409,
      error: "Reconnect your mailbox before sending.",
      code: "needs_reconnect",
    };
  }

  const document = await loadEmailableDocument(
    input.businessId,
    input.documentType,
    input.documentId,
  );
  if (!document) {
    return { ok: false, status: 404, error: "Document not found." };
  }
  const blocker = documentSendBlocker(document);
  if (blocker) return { ok: false, status: 409, error: blocker, code: "not_sendable" };
  if (document.version !== input.documentVersion) {
    return {
      ok: false,
      status: 409,
      error: "This document changed since the preview was opened. Review the refreshed preview.",
      code: "stale_version",
    };
  }

  const payloadHash = sha256(
    JSON.stringify({
      type: document.type,
      id: document.id,
      version: document.version,
      connectionId: connection.id,
      to: to.value,
      cc: cc.value,
      subject: content.subject,
      bodyText: content.bodyText,
    }),
  );
  const outboxId = outboxIdFor(input.businessId, input.idempotencyKey);

  const existing = await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId).get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    if (data.payloadHash !== payloadHash) {
      return {
        ok: false,
        status: 409,
        error: "This send request was already used with different content.",
        code: "idempotency_conflict",
      };
    }
    return { ok: true, outboxId, status: data.status, created: false };
  }

  const pdf = await generateDocumentPdf(input.businessId, document);
  if (!pdf?.length) {
    return { ok: false, status: 422, error: "Could not generate the document PDF." };
  }
  if (pdf.length > EMAIL_MAX_PDF_BYTES) {
    return {
      ok: false,
      status: 422,
      error: "The PDF is larger than 2 MB. Send the document link instead.",
      code: "pdf_too_large",
    };
  }

  const actor = await readActor(input.actorId);
  const attachmentName = attachmentNameFor(document);
  const snapshot: EmailPayloadSnapshot = {
    from: connection.address,
    fromName: document.businessName,
    to: to.value,
    cc: cc.value,
    subject: content.subject,
    bodyText: content.bodyText,
    attachmentName,
    attachmentBytes: pdf.length,
  };

  const pdfStorageKey = await savePdf(input.businessId, outboxId, pdf);
  const created = await createOutboxItem(outboxId, payloadHash, {
    kind: "document",
    businessId: input.businessId,
    connectionId: connection.id,
    connectionGeneration: connection.generation,
    providerAccountId: connection.providerAccountId,
    provider: connection.provider,
    documentType: document.type,
    documentId: document.id,
    documentVersion: document.version,
    documentCode: document.code,
    customerName: document.customerName,
    actorId: input.actorId,
    actorName: actor.name,
    payloadSnapshot: snapshot,
    pdfStorageKey,
    idempotencyKey: input.idempotencyKey,
    internetMessageId: generateMessageId(connection.address),
  });
  if (!created.ok || !created.created) await deletePdf(pdfStorageKey);
  if (!created.ok) return created;
  return {
    ok: true,
    outboxId: created.item.outboxId,
    status: created.item.status,
    created: created.created,
  };
}

export type MailboxAttachmentInput = {
  name: string;
  contentType: string;
  content: Buffer;
};

/** Attachment names safe for headers and storage paths. */
function cleanFileName(name: string): string {
  const cleaned = name.replace(/[\r\n"\\/]+/g, "_").trim().slice(0, 150);
  return cleaned || "attachment";
}

function cleanContentType(value: string): string {
  return /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : "application/octet-stream";
}

/**
 * Queues a new email, reply or forward from the mailbox. Recipients, content
 * and every attachment are frozen at queue time, exactly like quote/invoice
 * sends; the Idempotency-Key makes a resubmitted request a no-op.
 */
export async function enqueueMailboxMessage(input: {
  businessId: string;
  actorId: string;
  idempotencyKey: string;
  connection: EmailConnectionRecord;
  to: unknown;
  cc: unknown;
  bcc: unknown;
  subject: unknown;
  bodyText: unknown;
  attachments: MailboxAttachmentInput[];
  thread: SendThread | null;
  /** What the message replies to or forwards, for the history label. */
  intent: "new" | "reply" | "forward";
}): Promise<
  { ok: true; outboxId: string; status: EmailOutboxStatus; created: boolean } | OutboxError
> {
  const to = normaliseRecipients(input.to, "To");
  if (!to.ok) return to;
  const cc = normaliseRecipients(input.cc, "CC");
  if (!cc.ok) return cc;
  const bcc = normaliseRecipients(input.bcc, "BCC");
  if (!bcc.ok) return bcc;
  if (to.value.length === 0) {
    return { ok: false, status: 422, error: "Add at least one recipient." };
  }
  if (to.value.length + cc.value.length + bcc.value.length > EMAIL_MAX_RECIPIENTS) {
    return {
      ok: false,
      status: 422,
      error: `Send to at most ${EMAIL_MAX_RECIPIENTS} recipients.`,
    };
  }
  const content = validateContent(input.subject, input.bodyText);
  if (!content.ok) return content;
  if (input.connection.status !== "active") {
    return { ok: false, status: 409, error: "Reconnect your mailbox before sending.", code: "needs_reconnect" };
  }
  if (input.attachments.length > MAILBOX_ATTACHMENTS_MAX_FILES) {
    return {
      ok: false,
      status: 422,
      error: `Attach at most ${MAILBOX_ATTACHMENTS_MAX_FILES} files.`,
    };
  }
  const totalBytes = input.attachments.reduce((sum, file) => sum + file.content.length, 0);
  if (totalBytes > MAILBOX_ATTACHMENTS_MAX_BYTES) {
    return { ok: false, status: 422, error: "Attachments are larger than 15 MB in total." };
  }

  const files = input.attachments.map((file) => ({
    name: cleanFileName(file.name),
    contentType: cleanContentType(file.contentType),
    content: file.content,
    hash: createHash("sha256").update(file.content).digest("hex"),
  }));
  const payloadHash = sha256(
    JSON.stringify({
      connectionId: input.connection.id,
      to: to.value,
      cc: cc.value,
      bcc: bcc.value,
      subject: content.subject,
      bodyText: content.bodyText,
      thread: input.thread,
      files: files.map((file) => [file.name, file.hash]),
    }),
  );
  const outboxId = outboxIdFor(input.businessId, input.idempotencyKey);

  const existing = await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId).get();
  if (existing.exists) {
    const data = existing.data() ?? {};
    if (data.payloadHash !== payloadHash) {
      return {
        ok: false,
        status: 409,
        error: "This send request was already used with different content.",
        code: "idempotency_conflict",
      };
    }
    return { ok: true, outboxId, status: data.status, created: false };
  }

  const bucket = adminStorage.bucket(getStorageBucketName());
  const stored: { storageKey: string; name: string; contentType: string; size: number }[] = [];
  try {
    for (const file of files) {
      const storageKey = `email-outbox/${input.businessId}/${outboxId}-${randomBytes(6).toString("hex")}`;
      await bucket.file(storageKey).save(file.content, {
        resumable: false,
        metadata: { contentType: file.contentType, cacheControl: "private, no-store" },
      });
      stored.push({ storageKey, name: file.name, contentType: file.contentType, size: file.content.length });
    }
  } catch {
    await Promise.all(stored.map((file) => deletePdf(file.storageKey)));
    return { ok: false, status: 503, error: "Could not store the attachments. Try again." };
  }

  const actor = await readActor(input.actorId);
  const snapshot: EmailPayloadSnapshot = {
    from: input.connection.address,
    fromName: input.connection.displayName,
    to: to.value,
    cc: cc.value,
    bcc: bcc.value,
    subject: content.subject,
    bodyText: content.bodyText,
    attachmentName: null,
    attachmentBytes: totalBytes || null,
    attachmentNames: stored.map((file) => file.name),
    thread: input.thread,
  };
  const created = await createOutboxItem(outboxId, payloadHash, {
    kind: "message",
    intent: input.intent,
    businessId: input.businessId,
    connectionId: input.connection.id,
    connectionGeneration: input.connection.generation,
    providerAccountId: input.connection.providerAccountId,
    provider: input.connection.provider,
    documentType: null,
    documentId: null,
    documentVersion: null,
    documentCode: null,
    customerName: null,
    actorId: input.actorId,
    actorName: actor.name,
    payloadSnapshot: snapshot,
    pdfStorageKey: null,
    attachmentFiles: stored.map(({ storageKey, name, contentType, size }) => ({
      storageKey,
      name,
      contentType,
      size,
    })),
    idempotencyKey: input.idempotencyKey,
    internetMessageId: generateMessageId(input.connection.address),
  });
  if (!created.ok || !created.created) {
    await Promise.all(stored.map((file) => deletePdf(file.storageKey)));
  }
  if (!created.ok) return created;
  return {
    ok: true,
    outboxId: created.item.outboxId,
    status: created.item.status,
    created: created.created,
  };
}

// ---- Worker ----------------------------------------------------------------

async function settle(
  outboxId: string,
  businessId: string,
  connectionId: string | null,
  status: EmailOutboxStatus,
  eventType: EmailEventType,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId).update({
    ...patch,
    status,
    leaseUntil: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await recordEmailEvent({
    businessId,
    eventType,
    outboxId,
    connectionId,
    safeErrorDetail:
      typeof patch.errorCode === "string" ? patch.errorCode : null,
  });
}

function backoffMs(attempt: number, retryAfterSeconds: number | null): number {
  const base =
    EMAIL_BACKOFF_SECONDS[Math.min(attempt, EMAIL_BACKOFF_SECONDS.length) - 1] ??
    EMAIL_BACKOFF_SECONDS[EMAIL_BACKOFF_SECONDS.length - 1];
  const seconds = Math.max(base, retryAfterSeconds ?? 0);
  return Math.round(seconds * 1000 * (1 + Math.random() * 0.2));
}

/**
 * Claims one item with a lease and sends exactly its stored snapshot. Safe to
 * call concurrently: the claim transaction lets only one worker proceed.
 */
export async function processOutboxItem(outboxId: string): Promise<EmailOutboxStatus | null> {
  const ref = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId);
  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    if (data.status !== "queued" && data.status !== "retry_wait") return null;
    if ((toMillis(data.nextAttemptAt) ?? 0) > Date.now()) return null;
    tx.update(ref, {
      status: "sending",
      leaseUntil: Timestamp.fromMillis(Date.now() + EMAIL_LEASE_MS),
      attemptCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ...data, attemptCount: (Number(data.attemptCount) || 0) + 1 } as DocumentData;
  });
  if (!claimed) return null;

  const businessId = String(claimed.businessId);
  const connectionId = String(claimed.connectionId);

  // Recheck the sender's permission and the mailbox at send time.
  if (!(await actorCanSend(String(claimed.actorId), businessId))) {
    await settle(outboxId, businessId, connectionId, "held", "held", {
      errorCode: "permission_revoked",
      safeErrorDetail: "The person who queued this email can no longer send email.",
    });
    return "held";
  }

  const connection = await getEmailConnectionById(businessId, connectionId);
  if (
    !connection ||
    connection.status === "disconnected" ||
    connection.generation !== claimed.connectionGeneration ||
    connection.providerAccountId !== claimed.providerAccountId
  ) {
    await settle(outboxId, businessId, connectionId, "held", "held", {
      errorCode: "sender_changed",
      safeErrorDetail: "The sending mailbox changed after this email was queued.",
    });
    return "held";
  }
  if (connection.status === "needs_reconnect") {
    await settle(outboxId, businessId, connectionId, "blocked_auth", "blocked_auth", {
      errorCode: connection.lastErrorCode ?? "needs_reconnect",
      safeErrorDetail: "Reconnect the mailbox, then resume this email.",
    });
    return "blocked_auth";
  }

  const credentials = await freshCredentials(connection);
  if (!credentials.ok) {
    if (credentials.authFailure) {
      await markConnectionNeedsReconnect(connection, credentials.code);
      await settle(outboxId, businessId, connectionId, "blocked_auth", "blocked_auth", {
        errorCode: credentials.code,
        safeErrorDetail: "Reconnect the mailbox, then resume this email.",
      });
      return "blocked_auth";
    }
    return scheduleRetry(outboxId, businessId, connectionId, claimed.attemptCount, {
      code: credentials.code,
      detail: "Could not refresh the mailbox sign-in.",
      retryAfterSeconds: null,
    });
  }

  const snapshot = claimed.payloadSnapshot as EmailPayloadSnapshot;
  // Every attachment was frozen in Storage at queue time.
  const files: { storageKey: string; name: string; contentType: string }[] = [];
  if (typeof claimed.pdfStorageKey === "string" && claimed.pdfStorageKey) {
    files.push({
      storageKey: claimed.pdfStorageKey,
      name: snapshot.attachmentName ?? "document.pdf",
      contentType: "application/pdf",
    });
  }
  if (Array.isArray(claimed.attachmentFiles)) {
    for (const file of claimed.attachmentFiles as Record<string, unknown>[]) {
      if (typeof file.storageKey !== "string") continue;
      files.push({
        storageKey: file.storageKey,
        name: typeof file.name === "string" ? file.name : "attachment",
        contentType:
          typeof file.contentType === "string" ? file.contentType : "application/octet-stream",
      });
    }
  }
  const attachments: { filename: string; contentType: string; content: Buffer }[] = [];
  for (const file of files) {
    try {
      const [content] = await adminStorage
        .bucket(getStorageBucketName())
        .file(file.storageKey)
        .download();
      attachments.push({ filename: file.name, contentType: file.contentType, content });
    } catch {
      return scheduleRetry(outboxId, businessId, connectionId, claimed.attemptCount, {
        code: "attachment_unavailable",
        detail: "A stored attachment could not be read.",
        retryAfterSeconds: null,
      });
    }
  }

  const adapter = getEmailAdapter(connection.provider);
  if (!adapter) {
    await settle(outboxId, businessId, connectionId, "failed", "failed", {
      errorCode: "provider_unsupported",
      safeErrorDetail: "This email provider is not supported.",
    });
    return "failed";
  }

  const result = await adapter.send(credentials.credentials, {
    from: snapshot.from,
    fromName: snapshot.fromName,
    to: snapshot.to,
    cc: snapshot.cc,
    bcc: snapshot.bcc ?? [],
    subject: snapshot.subject,
    bodyText: snapshot.bodyText,
    messageId: String(claimed.internetMessageId),
    outboxId,
    attachments,
    thread: snapshot.thread ?? null,
  });

  switch (result.kind) {
    case "accepted":
      await settle(outboxId, businessId, connectionId, "accepted", "accepted", {
        providerMessageId: result.providerMessageId,
        providerThreadId: result.providerThreadId,
        acceptedAt: FieldValue.serverTimestamp(),
        errorCode: null,
        safeErrorDetail: null,
      });
      return "accepted";
    case "auth_failure":
      await markConnectionNeedsReconnect(connection, result.code);
      await settle(outboxId, businessId, connectionId, "blocked_auth", "blocked_auth", {
        errorCode: result.code,
        safeErrorDetail: result.detail,
      });
      return "blocked_auth";
    case "unknown":
      await settle(outboxId, businessId, connectionId, "unknown", "unknown", {
        errorCode: result.code,
        safeErrorDetail: result.detail,
      });
      return "unknown";
    case "safe_failure":
      if (!result.retryable) {
        await settle(outboxId, businessId, connectionId, "failed", "failed", {
          errorCode: result.code,
          safeErrorDetail: result.detail,
        });
        return "failed";
      }
      return scheduleRetry(outboxId, businessId, connectionId, claimed.attemptCount, {
        code: result.code,
        detail: result.detail,
        retryAfterSeconds: result.retryAfterSeconds,
      });
  }
}

async function scheduleRetry(
  outboxId: string,
  businessId: string,
  connectionId: string,
  attemptCount: number,
  failure: { code: string; detail: string; retryAfterSeconds: number | null },
): Promise<EmailOutboxStatus> {
  if (attemptCount >= EMAIL_MAX_ATTEMPTS) {
    await settle(outboxId, businessId, connectionId, "failed", "failed", {
      errorCode: failure.code,
      safeErrorDetail: `${failure.detail} Gave up after ${attemptCount} attempts.`,
    });
    return "failed";
  }
  await settle(outboxId, businessId, connectionId, "retry_wait", "retry_scheduled", {
    errorCode: failure.code,
    safeErrorDetail: failure.detail,
    nextAttemptAt: Timestamp.fromMillis(
      Date.now() + backoffMs(attemptCount, failure.retryAfterSeconds),
    ),
  });
  return "retry_wait";
}

/**
 * Cron entry point: marks crashed sends as unknown (never blindly resent),
 * then works through due items.
 */
export async function processEmailOutbox(): Promise<{
  processed: number;
  markedUnknown: number;
  results: Partial<Record<EmailOutboxStatus, number>>;
}> {
  const col = adminDb.collection(EMAIL_OUTBOX_COLLECTION);
  const now = Timestamp.now();

  const stale = await col
    .where("status", "==", "sending")
    .where("leaseUntil", "<", now)
    .limit(EMAIL_OUTBOX_BATCH_SIZE)
    .get();
  let markedUnknown = 0;
  for (const doc of stale.docs) {
    const moved = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(doc.ref);
      const data = snap.data() ?? {};
      if (data.status !== "sending" || (toMillis(data.leaseUntil) ?? 0) >= Date.now()) {
        return false;
      }
      tx.update(doc.ref, {
        status: "unknown",
        leaseUntil: null,
        errorCode: "worker_interrupted",
        safeErrorDetail: "Sending was interrupted. Check your Sent folder before resending.",
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (moved) {
      markedUnknown += 1;
      const data = doc.data();
      await recordEmailEvent({
        businessId: String(data.businessId),
        eventType: "unknown",
        outboxId: doc.id,
        connectionId: String(data.connectionId),
        safeErrorDetail: "worker_interrupted",
      });
    }
  }

  const due = await col
    .where("status", "in", ["queued", "retry_wait"])
    .where("nextAttemptAt", "<=", now)
    .orderBy("nextAttemptAt", "asc")
    .limit(EMAIL_OUTBOX_BATCH_SIZE)
    .get();
  const results: Partial<Record<EmailOutboxStatus, number>> = {};
  let processed = 0;
  for (const doc of due.docs) {
    try {
      const status = await processOutboxItem(doc.id);
      if (!status) continue;
      processed += 1;
      results[status] = (results[status] ?? 0) + 1;
    } catch (error) {
      console.error("[email/outbox] item failed", doc.id, (error as Error)?.name);
    }
  }
  return { processed, markedUnknown, results };
}

// ---- History and recovery --------------------------------------------------

export function mapHistoryItem(id: string, data: DocumentData): EmailSendHistoryItem {
  const snapshot = (data.payloadSnapshot ?? {}) as Partial<EmailPayloadSnapshot>;
  const status = data.status as EmailOutboxStatus;
  return {
    id,
    kind: data.kind === "test" ? "test" : data.kind === "message" ? "message" : "document",
    documentType:
      data.documentType === "quote" || data.documentType === "invoice"
        ? data.documentType
        : null,
    documentId: typeof data.documentId === "string" ? data.documentId : null,
    documentCode: typeof data.documentCode === "string" ? data.documentCode : null,
    customerName: typeof data.customerName === "string" ? data.customerName : null,
    status,
    from: snapshot.from ?? "",
    to: snapshot.to ?? [],
    cc: snapshot.cc ?? [],
    subject: snapshot.subject ?? "",
    attachmentName: snapshot.attachmentName ?? null,
    actorName: typeof data.actorName === "string" ? data.actorName : null,
    attemptCount: Number(data.attemptCount) || 0,
    errorCode: typeof data.errorCode === "string" ? data.errorCode : null,
    errorDetail: typeof data.safeErrorDetail === "string" ? data.safeErrorDetail : null,
    createdAt: toMillis(data.createdAt),
    acceptedAt: toMillis(data.acceptedAt),
    canRetry: RETRYABLE_BY_STAFF.includes(status),
  };
}

export async function listDocumentEmailHistory(input: {
  businessId: string;
  documentType: EmailDocumentType;
  documentId: string;
  cursor: string | null;
  limit?: number;
}): Promise<{ items: EmailSendHistoryItem[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  let query = adminDb
    .collection(EMAIL_OUTBOX_COLLECTION)
    .where("businessId", "==", input.businessId)
    .where("documentType", "==", input.documentType)
    .where("documentId", "==", input.documentId)
    .orderBy("createdAt", "desc")
    .limit(limit + 1);
  if (input.cursor) {
    const cursorSnap = await adminDb
      .collection(EMAIL_OUTBOX_COLLECTION)
      .doc(input.cursor)
      .get();
    if (cursorSnap.exists && cursorSnap.data()?.businessId === input.businessId) {
      query = query.startAfter(cursorSnap);
    }
  }
  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  return {
    items: docs.map((doc) => mapHistoryItem(doc.id, doc.data())),
    nextCursor: snap.docs.length > limit ? (docs[docs.length - 1]?.id ?? null) : null,
  };
}

/** Status groups for the Emails page filter. */
export const EMAIL_LIST_FILTERS = {
  attention: ["failed", "blocked_auth", "unknown", "held"],
  in_progress: ["queued", "sending", "retry_wait"],
  accepted: ["accepted"],
} as const satisfies Record<string, readonly EmailOutboxStatus[]>;

export type EmailListFilter = keyof typeof EMAIL_LIST_FILTERS | "all";

export function parseEmailListFilter(value: string | null): EmailListFilter {
  return value && value in EMAIL_LIST_FILTERS ? (value as EmailListFilter) : "all";
}

/** Every send for the business (documents and tests), newest first. */
export async function listBusinessEmails(input: {
  businessId: string;
  filter: EmailListFilter;
  cursor: string | null;
  limit?: number;
}): Promise<{ items: EmailSendHistoryItem[]; nextCursor: string | null }> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 25));
  let query = adminDb
    .collection(EMAIL_OUTBOX_COLLECTION)
    .where("businessId", "==", input.businessId);
  if (input.filter !== "all") {
    query = query.where("status", "in", [...EMAIL_LIST_FILTERS[input.filter]]);
  }
  query = query.orderBy("createdAt", "desc").limit(limit + 1);
  if (input.cursor && !input.cursor.includes("/")) {
    const cursorSnap = await adminDb
      .collection(EMAIL_OUTBOX_COLLECTION)
      .doc(input.cursor)
      .get();
    if (cursorSnap.exists && cursorSnap.data()?.businessId === input.businessId) {
      query = query.startAfter(cursorSnap);
    }
  }
  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  return {
    items: docs.map((doc) => mapHistoryItem(doc.id, doc.data())),
    nextCursor: snap.docs.length > limit ? (docs[docs.length - 1]?.id ?? null) : null,
  };
}

/**
 * Re-queues a failed, held, blocked or unknown item. Requires the same sender
 * identity, and explicit confirmation for unknown outcomes (it may already
 * have been delivered).
 */
export async function retryOutboxItem(input: {
  businessId: string;
  actorId: string;
  outboxId: string;
  confirmUnknown: boolean;
}): Promise<{ ok: true; status: EmailOutboxStatus } | OutboxError> {
  if (!input.outboxId.trim() || input.outboxId.includes("/")) {
    return { ok: false, status: 404, error: "Email not found." };
  }
  const ref = adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(input.outboxId.trim());
  const snap = await ref.get();
  const data = snap.data();
  if (!snap.exists || !data || data.businessId !== input.businessId) {
    return { ok: false, status: 404, error: "Email not found." };
  }
  const status = data.status as EmailOutboxStatus;
  if (!RETRYABLE_BY_STAFF.includes(status)) {
    return { ok: false, status: 409, error: "This email cannot be retried." };
  }
  if (status === "unknown" && !input.confirmUnknown) {
    return {
      ok: false,
      status: 409,
      error: "Check your Sent folder first — this email may already have been sent.",
      code: "confirm_unknown",
    };
  }

  const connection = await getEmailConnectionById(
    input.businessId,
    String(data.connectionId),
  );
  if (!connection || connection.status !== "active") {
    return {
      ok: false,
      status: 409,
      error: "Reconnect your mailbox before resuming this email.",
      code: "needs_reconnect",
    };
  }
  if (connection.providerAccountId !== data.providerAccountId) {
    return {
      ok: false,
      status: 409,
      error: "This email was queued for a different mailbox and can't be resent from this one.",
      code: "sender_changed",
    };
  }

  // Whoever resumes the email becomes responsible for it, so the worker's
  // permission recheck applies to them rather than the original sender.
  const actor = await readActor(input.actorId);
  await ref.update({
    status: "queued",
    attemptCount: 0,
    nextAttemptAt: Timestamp.now(),
    leaseUntil: null,
    actorId: input.actorId,
    actorName: actor.name,
    connectionGeneration: connection.generation,
    errorCode: null,
    safeErrorDetail: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await recordEmailEvent({
    businessId: input.businessId,
    eventType: "retry_requested",
    outboxId: input.outboxId,
    connectionId: connection.id,
    actorId: input.actorId,
    safeErrorDetail: status,
  });
  return { ok: true, status: "queued" };
}

/** Reads one item for status polling after a send. */
export async function getOutboxItem(
  businessId: string,
  outboxId: string,
): Promise<EmailSendHistoryItem | null> {
  if (!outboxId.trim() || outboxId.includes("/")) return null;
  const snap = await adminDb.collection(EMAIL_OUTBOX_COLLECTION).doc(outboxId.trim()).get();
  const data = snap.data();
  if (!snap.exists || !data || data.businessId !== businessId) return null;
  return mapHistoryItem(snap.id, data);
}
