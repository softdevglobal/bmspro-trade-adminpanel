"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { EmailSendRow } from "@/components/email-send-row";
import {
  EmailApiError,
  emailApi,
  PENDING_EMAIL_STATUSES,
  useEmailSending,
} from "@/lib/email-integration/client";
import type {
  EmailDocumentType,
  EmailSendHistoryItem,
  EmailSendPreview,
} from "@/lib/email-integration/types";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

function documentPath(type: EmailDocumentType, id: string): string {
  return `/api/documents/${type}/${encodeURIComponent(id)}`;
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAud(value: number): string {
  return `$${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const INPUT =
  "w-full rounded-xl border border-outline-variant bg-white px-3 py-2.5 font-body text-[13px] text-on-surface outline-none focus:border-primary";
const LABEL = "mb-1 block font-body text-[12px] font-semibold text-on-surface";

/**
 * "Send by email" button plus send history for one quote or invoice. Renders
 * nothing unless business-mailbox sending is enabled for this owner.
 */
export function DocumentEmailPanel({
  documentType,
  documentId,
}: {
  documentType: EmailDocumentType;
  documentId: string;
}) {
  const { enabled, loading } = useEmailSending();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  if (loading || !enabled) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 font-body text-[14px] font-semibold text-primary transition-colors hover:bg-primary/10"
      >
        <span className="material-symbols-outlined text-[20px]">forward_to_inbox</span>
        Send {documentType === "quote" ? "quote" : "invoice"} by email
      </button>
      <DocumentEmailHistory
        documentType={documentType}
        documentId={documentId}
        version={historyVersion}
      />
      <SendDocumentEmailDialog
        open={dialogOpen}
        documentType={documentType}
        documentId={documentId}
        onClose={() => setDialogOpen(false)}
        onQueued={() => {
          setDialogOpen(false);
          setHistoryVersion((value) => value + 1);
        }}
      />
    </div>
  );
}

function SendDocumentEmailDialog({
  open,
  documentType,
  documentId,
  onClose,
  onQueued,
}: {
  open: boolean;
  documentType: EmailDocumentType;
  documentId: string;
  onClose: () => void;
  onQueued: () => void;
}) {
  const { user } = useAuth();
  const titleId = useId();
  const [preview, setPreview] = useState<EmailSendPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Reused only when the exact same request is resubmitted (e.g. after a
  // network drop); any edit makes it a new intentional send with a new key.
  const lastAttempt = useRef<{ signature: string; key: string } | null>(null);

  const loadPreview = useCallback(
    async (keepEdits: boolean) => {
      if (!user) return;
      setLoading(true);
      try {
        const { preview: next } = await emailApi<{ preview: EmailSendPreview }>(
          user,
          `${documentPath(documentType, documentId)}/email`,
        );
        setPreview(next);
        if (!keepEdits) {
          setTo(next.to.join(", "));
          setCc("");
          setSubject(next.subject);
          setBodyText(next.bodyText);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the email preview.");
      } finally {
        setLoading(false);
      }
    },
    [user, documentType, documentId],
  );

  useEffect(() => {
    if (!open) return;
    lastAttempt.current = null;
    queueMicrotask(() => {
      setError(null);
      setNotice(null);
      setPreview(null);
      void loadPreview(false);
    });
  }, [open, loadPreview]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose, sending]);

  if (!open) return null;

  const connection = preview?.connection ?? null;
  const canSend =
    Boolean(preview && connection?.status === "active") &&
    splitAddresses(to).length > 0 &&
    subject.trim().length > 0 &&
    bodyText.trim().length > 0;

  async function handleSend() {
    if (!user || !preview || !connection || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    const body = {
      connection_id: connection.id,
      document_version: preview.documentVersion,
      to: splitAddresses(to),
      cc: splitAddresses(cc),
      subject: subject.trim(),
      body_text: bodyText,
    };
    const signature = JSON.stringify(body);
    const key =
      lastAttempt.current?.signature === signature
        ? lastAttempt.current.key
        : crypto.randomUUID();
    lastAttempt.current = { signature, key };
    try {
      await emailApi(user, `${documentPath(documentType, documentId)}/email`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: signature,
      });
      onQueued();
    } catch (err) {
      if (err instanceof EmailApiError && err.code === "stale_version") {
        // Keep the user's edits but pick up the new document version and totals.
        lastAttempt.current = null;
        await loadPreview(true);
        setNotice("The document changed. Check the refreshed details, then send again.");
      } else {
        setError(err instanceof Error ? err.message : "Could not send the email.");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => (sending ? undefined : onClose())}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-outline-variant/60 px-5 py-4">
          <h2 id={titleId} className="font-display text-[18px] font-semibold text-on-surface">
            {preview
              ? `Email ${documentType === "quote" ? "quote" : "invoice"} ${preview.documentCode}`
              : `Email ${documentType === "quote" ? "quote" : "invoice"}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {loading && !preview ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="h-10 animate-pulse rounded-xl bg-surface-container-low" />
              ))}
            </div>
          ) : null}

          {preview && !connection ? (
            <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low px-4 py-3">
              <p className="font-body text-[13px] font-semibold text-on-surface">
                Connect your email first
              </p>
              <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                Connect Gmail or Outlook on the Emails page to send documents from your own address.
              </p>
              <Link
                href="/dashboard/emails"
                className="mt-2 inline-flex font-body text-[13px] font-semibold text-primary hover:underline"
              >
                Go to Emails
              </Link>
            </div>
          ) : null}

          {preview && connection?.status === "needs_reconnect" ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12px] text-amber-800">
              Your email sign-in expired.{" "}
              <Link href="/dashboard/emails" className="font-semibold underline">
                Reconnect on the Emails page
              </Link>{" "}
              before sending.
            </p>
          ) : null}

          {preview && connection ? (
            <>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 rounded-xl border border-outline-variant/60 bg-surface-container-low/70 px-4 py-3 font-body text-[12px]">
                <dt className="text-on-surface-variant">From</dt>
                <dd className="break-all font-semibold text-on-surface">{connection.address}</dd>
                <dt className="text-on-surface-variant">Customer</dt>
                <dd className="text-on-surface">{preview.customerName || "—"}</dd>
                <dt className="text-on-surface-variant">
                  {documentType === "invoice" ? "Balance due" : "Total"}
                </dt>
                <dd className="font-semibold text-on-surface">
                  {formatAud(
                    documentType === "invoice" ? preview.balanceDueAud : preview.totalAud,
                  )}
                </dd>
                <dt className="text-on-surface-variant">Attachment</dt>
                <dd className="flex items-center gap-1 text-on-surface">
                  <span className="material-symbols-outlined text-[16px] text-rose-600">
                    picture_as_pdf
                  </span>
                  {preview.attachmentName}
                </dd>
              </dl>

              <div>
                <label htmlFor={`${titleId}-to`} className={LABEL}>
                  To
                </label>
                <input
                  id={`${titleId}-to`}
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  placeholder="customer@example.com"
                  className={INPUT}
                />
                {preview.to.length === 0 ? (
                  <p className="mt-1 font-body text-[11px] text-on-surface-variant">
                    This customer has no email address saved. Add one here or on the customer.
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor={`${titleId}-cc`} className={LABEL}>
                  CC <span className="font-normal text-on-surface-variant">(optional)</span>
                </label>
                <input
                  id={`${titleId}-cc`}
                  value={cc}
                  onChange={(event) => setCc(event.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor={`${titleId}-subject`} className={LABEL}>
                  Subject
                </label>
                <input
                  id={`${titleId}-subject`}
                  value={subject}
                  maxLength={200}
                  onChange={(event) => setSubject(event.target.value.replace(/[\r\n]+/g, " "))}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor={`${titleId}-body`} className={LABEL}>
                  Message
                </label>
                <textarea
                  id={`${titleId}-body`}
                  value={bodyText}
                  rows={9}
                  onChange={(event) => setBodyText(event.target.value)}
                  className={`${INPUT} resize-y leading-relaxed`}
                />
              </div>
              <p className="font-body text-[11px] text-on-surface-variant">
                Replies arrive in your normal email inbox.
              </p>
            </>
          ) : null}

          {notice ? (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12px] text-amber-800">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-outline-variant/60 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-outline-variant px-5 font-body text-[14px] font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend || sending}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-body text-[14px] font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-[18px] ${sending ? "animate-spin" : ""}`}>
              {sending ? "progress_activity" : "send"}
            </span>
            {sending ? "Queuing…" : `Send ${documentType === "quote" ? "quote" : "invoice"}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DocumentEmailHistory({
  documentType,
  documentId,
  version,
}: {
  documentType: EmailDocumentType;
  documentId: string;
  version: number;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<EmailSendHistoryItem[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const payload = await emailApi<{ items: EmailSendHistoryItem[] }>(
        user,
        `${documentPath(documentType, documentId)}/emails`,
      );
      setItems(payload.items);
    } catch {
      /* history is supplementary; keep what we have */
    }
  }, [user, documentType, documentId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, version]);

  const hasPending = items.some((item) => PENDING_EMAIL_STATUSES.includes(item.status));
  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [hasPending, load]);

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-3">
      <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        Email history
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <EmailSendRow item={item} onChanged={load} />
          </li>
        ))}
      </ul>
    </section>
  );
}
