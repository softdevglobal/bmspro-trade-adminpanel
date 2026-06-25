"use client";

import { PdfCanvasViewer } from "@/components/pdf-canvas-viewer";
import { printPdfBytes } from "@/lib/pdf/print-pdf";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  pdfUrl: string;
  title?: string;
  downloadFilename?: string;
  /** Preferred on customer portal — avoids mobile iframe/CORS issues. */
  loadPdfBytes?: () => Promise<Uint8Array>;
};

export function QuotationPdfViewerModal({
  open,
  onClose,
  pdfUrl,
  title = "Quotation PDF",
  downloadFilename,
  loadPdfBytes,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchPdfData = useCallback(async () => {
    if (loadPdfBytes) {
      return loadPdfBytes();
    }
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error("Could not load PDF.");
    }
    return new Uint8Array(await response.arrayBuffer());
  }, [loadPdfBytes, pdfUrl]);

  useEffect(() => {
    if (!open) {
      setLoading(true);
      setPdfData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchPdfData()
      .then((bytes) => {
        if (cancelled) return;
        setPdfData(bytes.slice());
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load this PDF. Try downloading it instead.");
        setLoading(false);
      });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelled = true;
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fetchPdfData, onClose, open]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const bytes = (pdfData ?? (await fetchPdfData())).slice();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadFilename ?? "document.pdf";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  async function printPdf() {
    setPrinting(true);
    try {
      const bytes = (pdfData ?? (await fetchPdfData())).slice();
      await printPdfBytes(bytes);
    } catch {
      setError("Could not print this PDF. Try downloading it instead.");
    } finally {
      setPrinting(false);
    }
  }

  async function openInNewTab() {
    try {
      const bytes = (pdfData ?? (await fetchPdfData())).slice();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    }
  }

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-stretch justify-center p-0 sm:items-center sm:p-4">
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
        className="relative flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden border border-outline-variant bg-surface-container-lowest shadow-2xl sm:h-[min(92vh,900px)] sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-container-low px-3 py-3 sm:gap-3 sm:px-5">
          <span className="material-symbols-outlined shrink-0 text-[22px] text-primary">
            picture_as_pdf
          </span>
          <h2
            id="quotation-pdf-title"
            className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold text-on-surface sm:text-[17px]"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={() => void printPdf()}
            disabled={printing || loading}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60 sm:gap-1.5 sm:px-3"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                printing ? "animate-spin" : ""
              }`}
            >
              {printing ? "progress_activity" : "print"}
            </span>
            <span className="hidden sm:inline">
              {printing ? "Printing…" : "Print"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void openInNewTab()}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container sm:px-3"
          >
            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
            <span className="hidden sm:inline">Open</span>
          </button>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={downloading}
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-2 font-body text-[12px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60 sm:gap-1.5 sm:px-3"
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                downloading ? "animate-spin" : ""
              }`}
            >
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
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </header>

        <div className="relative min-h-0 flex-1 bg-stone-100">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="material-symbols-outlined text-[40px] text-outline">
                picture_as_pdf
              </span>
              <p className="font-body text-[14px] text-on-surface-variant">{error}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void openInNewTab()}
                  className="rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary"
                >
                  Open PDF
                </button>
                <button
                  type="button"
                  onClick={() => void printPdf()}
                  className="rounded-xl border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface"
                >
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => void downloadPdf()}
                  className="rounded-xl border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface"
                >
                  Download
                </button>
              </div>
            </div>
          ) : pdfData ? (
            <PdfCanvasViewer
              data={pdfData}
              onReady={() => setLoading(false)}
              onError={(message) => {
                setError(message);
                setLoading(false);
              }}
            />
          ) : loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-stone-100">
              <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
                progress_activity
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
