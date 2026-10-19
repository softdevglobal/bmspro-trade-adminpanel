"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { emailApi } from "@/lib/email-integration/client";
import {
  extractAddresses,
  forwardBlock,
  forwardSubject,
  quoteForReply,
  replySubject,
} from "@/lib/email-integration/mailbox/parse";
import type { MailboxContact, MailboxThreadMessage } from "@/lib/email-integration/types";
import { useBodyScrollLock } from "@/lib/ui/use-body-scroll-lock";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ComposerDraft =
  | { intent: "new"; to?: string[] }
  | { intent: "reply"; replyAll: boolean; source: MailboxThreadMessage }
  | { intent: "forward"; source: MailboxThreadMessage };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;
const INPUT =
  "w-full rounded-xl border border-outline-variant bg-white px-3 py-2.5 font-body text-[13px] text-on-surface outline-none focus:border-primary";

function formatDate(timestamp: number | null): string {
  return timestamp
    ? new Date(timestamp).toLocaleString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
}

function sender(message: MailboxThreadMessage): string {
  return message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress;
}

/** Prefilled recipients, subject and body for a new email, reply or forward. */
function initialFields(draft: ComposerDraft, ownAddress: string) {
  const own = ownAddress.toLowerCase();
  if (draft.intent === "new") {
    return { to: draft.to ?? [], cc: [] as string[], subject: "", body: "" };
  }
  const source = draft.source;
  const text = source.bodyText ?? "";
  if (draft.intent === "forward") {
    return {
      to: [] as string[],
      cc: [] as string[],
      subject: forwardSubject(source.subject),
      body: forwardBlock({
        from: sender(source),
        date: formatDate(source.date),
        subject: source.subject.trim(),
        to: source.to,
        cc: source.cc,
        bodyText: text,
      }),
    };
  }
  // Replying to our own sent message goes back to its recipients.
  const fromSelf = source.fromAddress.toLowerCase() === own;
  const primary = (fromSelf ? extractAddresses(source.to) : [source.fromAddress.toLowerCase()]).filter(
    (address) => address !== own,
  );
  const others = draft.replyAll
    ? extractAddresses(source.to, source.cc).filter(
        (address) => address !== own && !primary.includes(address),
      )
    : [];
  return {
    to: primary,
    cc: others,
    subject: replySubject(source.subject),
    body: quoteForReply({ from: sender(source), date: formatDate(source.date), bodyText: text }),
  };
}

function RecipientField({
  label,
  value,
  onChange,
  contacts,
  autoFocus,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  contacts: MailboxContact[];
  autoFocus?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => {
    const query = text.trim().toLowerCase();
    if (!query) return [];
    return contacts
      .filter(
        (contact) =>
          !value.includes(contact.email) &&
          (contact.email.includes(query) || contact.name.toLowerCase().includes(query)),
      )
      .slice(0, 6);
  }, [text, contacts, value]);

  function commit(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange([...new Set([...value, ...parts])]);
    setText("");
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block font-body text-[12px] font-semibold text-on-surface">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-outline-variant bg-white px-2 py-1.5 focus-within:border-primary">
        {value.map((address) => (
          <span
            key={address}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[12px] ${
              ADDRESS.test(address) ? "bg-primary/10 text-primary" : "bg-rose-100 text-rose-700"
            }`}
          >
            {contacts.find((contact) => contact.email === address)?.name || address}
            <button
              type="button"
              aria-label={`Remove ${address}`}
              onClick={() => onChange(value.filter((item) => item !== address))}
              className="leading-none"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </span>
        ))}
        <input
          id={id}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            window.setTimeout(() => setFocused(false), 150);
            commit(text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "," || event.key === ";") {
              event.preventDefault();
              commit(text);
            } else if (event.key === "Backspace" && !text && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          placeholder={value.length === 0 ? "Name or email" : ""}
          className="h-7 min-w-[140px] flex-1 bg-transparent font-body text-[13px] text-on-surface outline-none"
        />
      </div>
      {focused && suggestions.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-outline-variant bg-white shadow-lg">
          {suggestions.map((contact) => (
            <li key={contact.email}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange([...value, contact.email]);
                  setText("");
                }}
                className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-container-low"
              >
                <span className="font-body text-[13px] font-semibold text-on-surface">
                  {contact.name || contact.email}
                </span>
                {contact.name ? (
                  <span className="font-body text-[11px] text-on-surface-variant">{contact.email}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** New email, reply, reply all or forward, sent from the connected Gmail. */
export function MailComposer({
  draft,
  fromAddress,
  canForwardAttachments,
  onClose,
  onSent,
}: {
  draft: ComposerDraft;
  fromAddress: string;
  canForwardAttachments: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const { user } = useAuth();
  const titleId = useId();
  // The page behind the composer must not scroll while it is open.
  useBodyScrollLock(true);
  const initial = useMemo(() => initialFields(draft, fromAddress), [draft, fromAddress]);
  const [to, setTo] = useState<string[]>(initial.to);
  const [cc, setCc] = useState<string[]>(initial.cc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCopies, setShowCopies] = useState(initial.cc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [files, setFiles] = useState<File[]>([]);
  const originalAttachments =
    draft.intent === "forward" ? draft.source.attachments.filter((item) => item.attachmentId) : [];
  const [includeOriginals, setIncludeOriginals] = useState(originalAttachments.length > 0);
  const [contacts, setContacts] = useState<MailboxContact[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(picked: File[]) {
    if (picked.length === 0) return;
    setFiles((current) => [...current, ...picked].slice(0, 10));
  }

  // Thumbnails for picked images; object URLs are released when files change.
  const previews = useMemo(
    () => files.map((file) => (/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) ? URL.createObjectURL(file) : null)),
    [files],
  );
  useEffect(
    () => () => previews.forEach((url) => url && URL.revokeObjectURL(url)),
    [previews],
  );
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastAttempt = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void emailApi<{ contacts: MailboxContact[] }>(user, "/api/email/mailbox/contacts")
      .then((payload) => {
        if (active) setContacts(payload.contacts);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    // Replies and forwards start typing above the quoted text.
    if (draft.intent !== "new") {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(0, 0);
    }
  }, [draft]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, sending]);

  const uploadBytes = files.reduce((sum, file) => sum + file.size, 0);
  const invalid = [...to, ...cc, ...bcc].filter((address) => !ADDRESS.test(address));
  const canSend =
    to.length > 0 && invalid.length === 0 && subject.trim().length > 0 && body.trim().length > 0 && !sending;

  async function send() {
    if (!user || !canSend) return;
    if (uploadBytes > MAX_UPLOAD_BYTES) {
      setError("Attachments from your computer can be up to 4 MB in total.");
      return;
    }
    setSending(true);
    setError(null);
    const payload = {
      intent: draft.intent,
      to,
      cc,
      bcc,
      subject: subject.trim(),
      body_text: body,
      ...(draft.intent === "reply" ? { reply_to_message_id: draft.source.id } : {}),
      ...(draft.intent === "forward"
        ? { forward_message_id: draft.source.id, include_original_attachments: includeOriginals }
        : {}),
    };
    const signature = JSON.stringify({ payload, files: files.map((file) => [file.name, file.size, file.lastModified]) });
    const key =
      lastAttempt.current?.signature === signature ? lastAttempt.current.key : crypto.randomUUID();
    lastAttempt.current = { signature, key };

    const form = new FormData();
    form.set("payload", JSON.stringify(payload));
    for (const file of files) form.append("attachments", file, file.name);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/email/mailbox/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key },
        body: form,
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Could not send the email.");
      setSent(true);
      window.setTimeout(onSent, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the email.");
    } finally {
      setSending(false);
    }
  }

  const title =
    draft.intent === "new" ? "New email" : draft.intent === "forward" ? "Forward" : draft.replyAll ? "Reply all" : "Reply";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={() => (sending ? undefined : onClose())}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-outline-variant/60 px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[17px] font-semibold text-on-surface">
              {title}
            </h2>
            <p className="truncate font-body text-[11px] text-on-surface-variant">From {fromAddress}</p>
          </div>
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <RecipientField label="To" value={to} onChange={setTo} contacts={contacts} autoFocus={draft.intent !== "reply"} />
          {showCopies ? (
            <>
              <RecipientField label="Cc" value={cc} onChange={setCc} contacts={contacts} />
              <RecipientField label="Bcc" value={bcc} onChange={setBcc} contacts={contacts} />
            </>
          ) : (
            <button type="button" onClick={() => setShowCopies(true)} className="font-body text-[12px] font-semibold text-primary hover:underline">
              Add Cc / Bcc
            </button>
          )}
          <div>
            <label htmlFor={`${titleId}-subject`} className="mb-1 block font-body text-[12px] font-semibold text-on-surface">
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
            <label htmlFor={`${titleId}-body`} className="mb-1 block font-body text-[12px] font-semibold text-on-surface">
              Message
            </label>
            <textarea
              id={`${titleId}-body`}
              ref={bodyRef}
              value={body}
              rows={12}
              onChange={(event) => setBody(event.target.value)}
              className={`${INPUT} resize-y leading-relaxed`}
            />
          </div>

          <div className="space-y-2">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(Array.from(event.dataTransfer.files));
              }}
              className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-3 py-3 transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-outline-variant/70"
              }`}
            >
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-outline-variant bg-white px-3 font-body text-[13px] font-semibold text-on-surface hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-[18px]">attach_file</span>
                Attach files
              </button>
              <span className="font-body text-[12px] text-on-surface-variant">
                or drop files here · up to 4 MB in total
              </span>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
            {files.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="relative flex w-36 flex-col overflow-hidden rounded-xl border border-outline-variant/60 bg-white"
                  >
                    {previews[index] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previews[index]!} alt={file.name} className="h-20 w-full object-cover" />
                    ) : (
                      <span className="flex h-20 w-full items-center justify-center bg-surface-container-low">
                        <span className="material-symbols-outlined text-[28px] text-on-surface-variant">
                          {file.type === "application/pdf" ? "picture_as_pdf" : "draft"}
                        </span>
                      </span>
                    )}
                    <span className="truncate px-2 pt-1 font-body text-[11px] font-semibold text-on-surface">{file.name}</span>
                    <span className="px-2 pb-1.5 font-body text-[10px] text-on-surface-variant">
                      {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setFiles(files.filter((_, i) => i !== index))}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {uploadBytes > MAX_UPLOAD_BYTES ? (
              <p className="font-body text-[12px] text-rose-700">These files are over 4 MB in total.</p>
            ) : null}
            {originalAttachments.length > 0 && canForwardAttachments ? (
              <label className="flex items-center gap-2 font-body text-[12px] text-on-surface">
                <input
                  type="checkbox"
                  checked={includeOriginals}
                  onChange={(event) => setIncludeOriginals(event.target.checked)}
                  className="h-4 w-4 rounded border-outline-variant text-primary"
                />
                Include the original attachments ({originalAttachments.map((item) => item.name).join(", ")})
              </label>
            ) : null}
          </div>

          {invalid.length > 0 ? (
            <p className="font-body text-[12px] text-rose-700">Check these addresses: {invalid.join(", ")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}
          {sent ? (
            <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-body text-[12px] text-emerald-800">
              Sending… it will appear in Sent shortly. Track it in the Send log.
            </p>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-outline-variant/60 px-5 py-3.5 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-outline-variant px-5 font-body text-[14px] font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend || sent}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 font-body text-[14px] font-semibold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-[18px] ${sending ? "animate-spin" : ""}`}>
              {sending ? "progress_activity" : "send"}
            </span>
            {sending ? "Sending…" : "Send"}
          </button>
        </footer>
      </div>
    </div>
  );
}
