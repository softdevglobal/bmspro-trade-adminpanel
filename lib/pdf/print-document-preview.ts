export const PRINT_DOCUMENT_ROOT = "data-print-document-root";

const PRINT_CLEANUP_MS = 60_000;

const PRINT_FRAME_STYLES = `
  @page {
    margin: 0;
    size: auto;
  }
  html,
  body {
    margin: 0;
    padding: 0;
    background: white;
  }
  [data-print-document-root] {
    position: static !important;
    inset: auto !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    box-shadow: none !important;
    --tw-ring-shadow: 0 0 #0000 !important;
  }
`;

function collectDocumentStyles(): string {
  const parts: string[] = [];

  for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
    parts.push(link.outerHTML);
  }

  for (const style of document.querySelectorAll("style")) {
    parts.push(style.outerHTML);
  }

  return parts.join("\n");
}

function waitForPrintFrameReady(doc: Document): Promise<void> {
  const sheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));

  const sheetLoads = sheets.map(
    (link) =>
      new Promise<void>((resolve) => {
        const el = link as HTMLLinkElement;
        if (el.sheet) {
          resolve();
          return;
        }

        el.addEventListener("load", () => resolve(), { once: true });
        el.addEventListener("error", () => resolve(), { once: true });
      }),
  );

  return Promise.all(sheetLoads).then(async () => {
    await doc.fonts?.ready;
  });
}

/** Prints the on-screen quotation/invoice HTML preview (create & preview tabs). */
export function printDocumentPreview(): void {
  const root = document.querySelector(`[${PRINT_DOCUMENT_ROOT}]`);
  if (!root) return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print document");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:none;";

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    iframe.remove();
  };

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    cleanup();
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Document</title>
  ${collectDocumentStyles()}
  <style>${PRINT_FRAME_STYLES}</style>
</head>
<body>
  ${root.outerHTML}
</body>
</html>`);
  doc.close();

  win.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, PRINT_CLEANUP_MS);

  void waitForPrintFrameReady(doc)
    .then(() => {
      win.focus();
      win.print();
    })
    .catch(() => {
      cleanup();
    });
}
