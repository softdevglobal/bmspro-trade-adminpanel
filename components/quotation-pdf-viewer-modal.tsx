"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  pdfUrl: string;
  title?: string;
  downloadFilename?: string;
};

export function QuotationPdfViewerModal({
  open,
  onClose,
  pdfUrl,
  title = "Quotation PDF",
  downloadFilename,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setLoading(true);
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error("Could not download PDF.");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadFilename ?? "quotation.pdf";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close PDF viewer"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/60 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quotation-pdf-title"
        className="relative flex h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-outline-variant bg-surface-container-low px-4 py-3 sm:px-5">
          <span className="material-symbols-outlined text-[22px] text-primary">
            picture_as_pdf
          </span>
          <h2
            id="quotation-pdf-title"
            className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-on-surface sm:text-[17px]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">
              {downloading ? "progress_activity" : "download"}
            </span>
            <span className="hidden sm:inline">
              {downloading ? "Downloading…" : "Download"}
            </span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </header>

        <div className="relative min-h-0 flex-1 bg-stone-100">
          {loading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-stone-100">
              <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
                progress_activity
              </span>
            </div>
          ) : null}
          <iframe
            src={pdfUrl}
            title={title}
            className="h-full w-full border-0 bg-white"
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
