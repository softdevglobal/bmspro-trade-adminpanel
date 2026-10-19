"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  emailApi,
  emailStatusLabel,
  emailStatusTone,
} from "@/lib/email-integration/client";
import type { EmailSendHistoryItem } from "@/lib/email-integration/types";
import Link from "next/link";
import { useState } from "react";

function formatWhen(timestamp: number | null): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function emailDocumentHref(item: EmailSendHistoryItem): string | null {
  if (!item.documentId) return null;
  const id = encodeURIComponent(item.documentId);
  if (item.documentType === "quote") return `/dashboard/quotations?view=${id}`;
  if (item.documentType === "invoice") return `/dashboard/invoices?view=${id}`;
  return null;
}

function documentLabel(item: EmailSendHistoryItem): string {
  if (item.kind === "test") return "Test email";
  const type = item.documentType === "quote" ? "Quote" : "Invoice";
  return item.documentCode ? `${type} ${item.documentCode}` : type;
}

/**
 * One send: status, recipients, sender and recovery actions. With
 * `showDocument`, also names and links the quote/invoice it belongs to.
 */
export function EmailSendRow({
  item,
  showDocument = false,
  onChanged,
}: {
  item: EmailSendHistoryItem;
  showDocument?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = showDocument ? emailDocumentHref(item) : null;

  async function retry() {
    if (!user) return;
    const confirmUnknown = item.status === "unknown";
    if (
      confirmUnknown &&
      !window.confirm(
        "This email may already have been sent. Check your Gmail Sent folder first. Send it again anyway?",
      )
    ) {
      return;
    }
    setRetrying(true);
    setError(null);
    try {
      await emailApi(user, `/api/email/outbox/${encodeURIComponent(item.id)}/retry`, {
        method: "POST",
        body: JSON.stringify({ confirm_unknown: confirmUnknown }),
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the email.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant/40 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 font-body text-[11px] font-semibold ${emailStatusTone(item.status)}`}
        >
          {emailStatusLabel(item.status)}
        </span>
        <span className="font-body text-[11px] text-on-surface-variant">
          {formatWhen(item.acceptedAt ?? item.createdAt)}
        </span>
      </div>
      {showDocument ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
          {href ? (
            <Link
              href={href}
              className="font-body text-[13px] font-semibold text-primary hover:underline"
            >
              {documentLabel(item)}
            </Link>
          ) : (
            <span className="font-body text-[13px] font-semibold text-on-surface">
              {documentLabel(item)}
            </span>
          )}
          {item.customerName ? (
            <span className="font-body text-[12px] text-on-surface-variant">
              {item.customerName}
            </span>
          ) : null}
        </div>
      ) : null}
      {showDocument && item.subject ? (
        <p className="mt-0.5 break-words font-body text-[12px] text-on-surface">{item.subject}</p>
      ) : null}
      <p className="mt-1 break-all font-body text-[12px] text-on-surface">
        To {[...item.to, ...item.cc].join(", ")}
      </p>
      <p className="font-body text-[11px] text-on-surface-variant">
        From {item.from}
        {item.actorName ? ` · by ${item.actorName}` : ""}
      </p>
      {item.errorDetail && item.status !== "accepted" ? (
        <p className="mt-1 font-body text-[11px] text-on-surface-variant">{item.errorDetail}</p>
      ) : null}
      {item.canRetry ? (
        <div className="mt-1.5 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={retrying}
            onClick={() => void retry()}
            className="font-body text-[12px] font-semibold text-primary hover:underline disabled:opacity-60"
          >
            {retrying ? "Resuming…" : item.status === "unknown" ? "Send again" : "Retry"}
          </button>
          {item.status === "blocked_auth" ? (
            <Link
              href="/dashboard/emails"
              className="font-body text-[12px] font-semibold text-primary hover:underline"
            >
              Reconnect mailbox
            </Link>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 font-body text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
