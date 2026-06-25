export const PRINT_DOCUMENT_ROOT = "data-print-document-root";

/** Prints the on-screen quotation/invoice HTML preview (create & preview tabs). */
export function printDocumentPreview(): void {
  const root = document.querySelector(`[${PRINT_DOCUMENT_ROOT}]`);
  if (!root) return;

  document.body.dataset.printingDocument = "true";

  const cleanup = () => {
    delete document.body.dataset.printingDocument;
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 60_000);
  window.print();
}
