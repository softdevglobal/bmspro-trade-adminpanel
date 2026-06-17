"use client";

import { useEffect, useRef, useState } from "react";

type PdfCanvasViewerProps = {
  data: Uint8Array;
  onReady?: () => void;
  onError?: (message: string) => void;
};

let pdfWorkerConfigured = false;

async function configurePdfWorker() {
  if (pdfWorkerConfigured) return;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  pdfWorkerConfigured = true;
}

export function PdfCanvasViewer({ data, onReady, onError }: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    async function renderPdf() {
      setRendering(true);
      if (!container) return;
      container.innerHTML = "";

      try {
        await configurePdfWorker();
        const pdfjs = await import("pdfjs-dist");
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled || !container) return;

          const baseViewport = page.getViewport({ scale: 1 });
          const containerWidth = Math.max(
            container.clientWidth - 16,
            Math.min(window.innerWidth - 24, 900),
          );
          const scale = containerWidth / baseViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className =
            "block max-w-full rounded-lg border border-outline-variant/40 bg-white shadow-sm";

          const wrapper = document.createElement("div");
          wrapper.className = "flex justify-center px-2 py-2";
          wrapper.appendChild(canvas);
          container.appendChild(wrapper);

          const context = canvas.getContext("2d");
          if (!context) continue;

          await page.render({ canvasContext: context, viewport, canvas }).promise;
        }

        if (!cancelled) {
          setRendering(false);
          onReady?.();
        }
      } catch {
        if (!cancelled) {
          setRendering(false);
          onError?.("Could not render this PDF on your device.");
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;
    };
  }, [data, onError, onReady]);

  return (
    <div className="relative h-full min-h-0">
      {rendering ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-stone-100">
          <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
            progress_activity
          </span>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="h-full min-h-0 overflow-y-auto overscroll-contain bg-stone-100 py-2"
      />
    </div>
  );
}
