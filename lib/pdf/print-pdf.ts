const PRINT_IFRAME_CLEANUP_MS = 60_000;

/** Opens the browser print dialog for a PDF byte array. */
export async function printPdfBytes(bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Print document");
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:none;";

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      URL.revokeObjectURL(url);
      iframe.remove();
    };

    const finish = () => {
      window.setTimeout(cleanup, PRINT_IFRAME_CLEANUP_MS);
      resolve();
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error("Could not open the print dialog."));
        return;
      }

      win.addEventListener("afterprint", finish, { once: true });

      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch {
          cleanup();
          reject(new Error("Could not open the print dialog."));
          return;
        }

        window.setTimeout(() => {
          if (!cleaned) finish();
        }, 5_000);
      }, 300);
    };

    iframe.onerror = () => {
      cleanup();
      reject(new Error("Could not load PDF for printing."));
    };

    document.body.appendChild(iframe);
    iframe.src = url;
  });
}

/** Loads a PDF from a same-origin URL or custom loader, then opens the print dialog. */
export async function printPdfFromUrl(
  pdfUrl: string,
  loadPdfBytes?: () => Promise<Uint8Array>,
): Promise<void> {
  let bytes: Uint8Array;
  if (loadPdfBytes) {
    bytes = await loadPdfBytes();
  } else if (
    pdfUrl.startsWith("blob:") ||
    pdfUrl.startsWith(typeof window !== "undefined" ? window.location.origin : "")
  ) {
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error("Could not load PDF for printing.");
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new Error(
      "Could not load PDF for printing. Use the app API instead of a direct file URL.",
    );
  }

  if (!bytes.length) {
    throw new Error("Could not load PDF for printing.");
  }

  await printPdfBytes(bytes);
}
