"use client";

import { useAuth } from "@/lib/auth/auth-context";
import type { MailboxAttachment } from "@/lib/email-integration/types";
import { useBodyScrollLock } from "@/lib/ui/use-body-scroll-lock";
import { useCallback, useEffect, useState } from "react";

type AuthUser = { getIdToken: () => Promise<string> };

/** Raster image types we preview. SVG is excluded: it can carry script. */
const PREVIEWABLE_IMAGES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/bmp"]);
const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

export function isPreviewableImage(attachment: MailboxAttachment): boolean {
  return PREVIEWABLE_IMAGES.has(attachment.mimeType.toLowerCase()) && attachment.size <= MAX_PREVIEW_BYTES;
}

function isPdf(attachment: MailboxAttachment): boolean {
  return attachment.mimeType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(attachment.name);
}

/**
 * Downloads an attachment and types the blob ourselves: only raster images and
 * PDFs keep their type, everything else is opaque bytes, so a disguised HTML
 * file can never be opened as a page in this app.
 */
export async function fetchAttachmentBlob(
  user: AuthUser,
  messageId: string,
  attachment: MailboxAttachment,
): Promise<Blob> {
  if (!attachment.attachmentId) throw new Error("This attachment can't be downloaded.");
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/email/mailbox/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Could not load the attachment.");
  }
  const bytes = await response.arrayBuffer();
  const type = isPreviewableImage(attachment)
    ? attachment.mimeType.toLowerCase()
    : isPdf(attachment)
      ? "application/pdf"
      : "application/octet-stream";
  return new Blob([bytes], { type });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Replaces `cid:` references in an email's HTML with the embedded images, so
 * logos and pasted pictures show in place (as data: URLs the preview frame
 * allows). Non-image parts are never inlined.
 */
export function useInlineImages(
  messageId: string,
  html: string | null,
  attachments: MailboxAttachment[],
): string | null {
  const { user } = useAuth();
  const [resolved, setResolved] = useState<string | null>(html);

  useEffect(() => {
    if (!html || !user || !/cid:/i.test(html)) {
      queueMicrotask(() => setResolved(html));
      return;
    }
    let active = true;
    const embedded = attachments.filter(
      (attachment) => attachment.contentId && isPreviewableImage(attachment),
    );
    void (async () => {
      let next = html;
      for (const attachment of embedded) {
        try {
          const dataUrl = await blobToDataUrl(await fetchAttachmentBlob(user, messageId, attachment));
          const cid = attachment.contentId!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          next = next.replace(new RegExp(`cid:${cid}`, "gi"), dataUrl);
        } catch {
          /* leave the reference; the frame shows nothing for it */
        }
      }
      if (active) setResolved(next);
    })();
    return () => {
      active = false;
    };
  }, [html, user, messageId, attachments]);

  return resolved;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileStyle(attachment: MailboxAttachment): { icon: string; tone: string; label: string } {
  const name = attachment.name.toLowerCase();
  const type = attachment.mimeType.toLowerCase();
  if (isPdf(attachment)) return { icon: "picture_as_pdf", tone: "bg-rose-50 text-rose-600", label: "PDF" };
  if (type.startsWith("image/")) return { icon: "image", tone: "bg-sky-50 text-sky-600", label: "Image" };
  if (/\.(docx?|odt|rtf|pages)$/.test(name) || type.includes("word")) {
    return { icon: "description", tone: "bg-blue-50 text-blue-600", label: "Document" };
  }
  if (/\.(xlsx?|csv|ods|numbers)$/.test(name) || type.includes("sheet") || type.includes("excel")) {
    return { icon: "table_chart", tone: "bg-emerald-50 text-emerald-600", label: "Spreadsheet" };
  }
  if (/\.(zip|rar|7z|gz|tar)$/.test(name)) return { icon: "folder_zip", tone: "bg-amber-50 text-amber-700", label: "Archive" };
  if (type.startsWith("video/")) return { icon: "movie", tone: "bg-violet-50 text-violet-600", label: "Video" };
  if (type.startsWith("audio/")) return { icon: "music_note", tone: "bg-violet-50 text-violet-600", label: "Audio" };
  return { icon: "draft", tone: "bg-slate-100 text-slate-600", label: "File" };
}

function ImageThumb({
  messageId,
  attachment,
  onOpen,
}: {
  messageId: string;
  attachment: MailboxAttachment;
  onOpen: (url: string) => void;
}) {
  const { user } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    let objectUrl: string | null = null;
    void fetchAttachmentBlob(user, messageId, attachment)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user, messageId, attachment]);

  return (
    <button
      type="button"
      onClick={() => url && onOpen(url)}
      disabled={!url}
      title={attachment.name}
      className="group relative h-32 w-40 overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-low"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={attachment.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <span className={`material-symbols-outlined text-[28px] text-on-surface-variant ${failed ? "" : "animate-pulse"}`}>
            {failed ? "broken_image" : "image"}
          </span>
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-left font-body text-[11px] font-semibold text-white">
        {attachment.name}
      </span>
    </button>
  );
}

/** Attachments of one message: image thumbnails, a viewer, and typed file cards. */
export function AttachmentGallery({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: MailboxAttachment[];
}) {
  const { user } = useAuth();
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock(Boolean(lightbox));

  // Images embedded in the body (cid:) are shown there, not repeated here.
  const visible = attachments.filter((attachment) => !(attachment.inline && attachment.contentId));
  const images = visible.filter(isPreviewableImage);
  const files = visible.filter((attachment) => !isPreviewableImage(attachment));

  const open = useCallback(
    async (attachment: MailboxAttachment, mode: "download" | "preview") => {
      if (!user) return;
      setBusy(attachment.attachmentId);
      setError(null);
      try {
        const blob = await fetchAttachmentBlob(user, messageId, attachment);
        const url = URL.createObjectURL(blob);
        if (mode === "preview") {
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          const link = document.createElement("a");
          link.href = url;
          link.download = attachment.name;
          link.click();
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open the attachment.");
      } finally {
        setBusy(null);
      }
    },
    [user, messageId],
  );

  useEffect(() => {
    if (!lightbox) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setLightbox(null);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightbox]);

  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 pt-1">
      <p className="flex items-center gap-1.5 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        <span className="material-symbols-outlined text-[15px]">attach_file</span>
        {visible.length} attachment{visible.length === 1 ? "" : "s"}
      </p>
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((attachment, index) => (
            <ImageThumb
              key={`${attachment.attachmentId}-${index}`}
              messageId={messageId}
              attachment={attachment}
              onOpen={(url) => setLightbox({ url, name: attachment.name })}
            />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {files.map((attachment, index) => {
            const style = fileStyle(attachment);
            return (
              <li
                key={`${attachment.attachmentId}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-outline-variant/60 bg-white px-3 py-2.5"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${style.tone}`}>
                  <span className="material-symbols-outlined text-[22px]">{style.icon}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-[13px] font-semibold text-on-surface">{attachment.name}</span>
                  <span className="block font-body text-[11px] text-on-surface-variant">
                    {style.label} · {formatBytes(attachment.size)}
                  </span>
                </span>
                {isPdf(attachment) ? (
                  <button
                    type="button"
                    disabled={!attachment.attachmentId || busy === attachment.attachmentId}
                    onClick={() => void open(attachment, "preview")}
                    className="rounded-lg px-2 py-1 font-body text-[12px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
                  >
                    Preview
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`Download ${attachment.name}`}
                  disabled={!attachment.attachmentId || busy === attachment.attachmentId}
                  onClick={() => void open(attachment, "download")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-[20px] ${busy === attachment.attachmentId ? "animate-spin" : ""}`}>
                    {busy === attachment.attachmentId ? "progress_activity" : "download"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="font-body text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}

      {lightbox ? (
        <div className="fixed inset-0 z-[120] flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={lightbox.name}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <p className="truncate font-body text-[13px] font-semibold">{lightbox.name}</p>
            <div className="flex items-center gap-1">
              <a
                href={lightbox.url}
                download={lightbox.name}
                className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
                aria-label="Download"
              >
                <span className="material-symbols-outlined">download</span>
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>
          <button type="button" className="flex min-h-0 flex-1 items-center justify-center p-4" onClick={() => setLightbox(null)} aria-label="Close">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.name} className="max-h-full max-w-full rounded-lg object-contain" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
