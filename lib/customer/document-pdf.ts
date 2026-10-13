import { readTrustedStorage } from "@/lib/security/storage-read";
import "server-only";

import {
  customerOwnsRequestRecord,
  type CustomerOwnershipIdentity,
} from "@/lib/customer/ownership";
import { adminDb } from "@/lib/firebase/admin";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";

export async function getCustomerDocumentPdf(
  requestId: string,
  kind: "quotation" | "invoice",
  identity: CustomerOwnershipIdentity,
): Promise<
  | { ok: true; bytes: Uint8Array; fileName: string }
  | { ok: false; status: number; error: string }
> {
  const snap = await adminDb.collection(REQUESTS_COLLECTION).doc(requestId).get();
  if (!snap.exists) {
    return { ok: false, status: 404, error: "Document not found." };
  }

  const request = mapInspectionDoc(snap.id, snap.data() ?? {});
  if (!customerOwnsRequestRecord(request, identity)) {
    return { ok: false, status: 404, error: "Document not found." };
  }

  const resolvedUrl =
    kind === "invoice"
      ? request.invoice?.pdfUrl?.trim() ?? null
      : request.quotation?.pdfUrl?.trim() ?? null;

  if (!resolvedUrl) {
    return { ok: false, status: 404, error: "PDF is not available yet." };
  }

  if (kind === "invoice") {
    const status = request.invoice?.status;
    if (status !== "sent" && status !== "paid") {
      return { ok: false, status: 403, error: "Invoice PDF is not available." };
    }
  } else if (request.quotation?.status !== "sent") {
    return { ok: false, status: 403, error: "Quotation PDF is not available." };
  }

  let buffer: Buffer;
  try {
    if (!request.businessId) throw new Error("Missing tenant.");
    buffer = await readTrustedStorage(resolvedUrl, [`${kind === "invoice" ? "invoices" : "quotations"}/${request.businessId}/`], "pdf");
  } catch { return { ok: false, status: 502, error: "Could not load the PDF file." }; }
  const code =
    kind === "invoice"
      ? request.invoice?.invoiceCode?.trim() || "invoice"
      : request.quotation?.quotationCode?.trim() || "quotation";

  return {
    ok: true,
    bytes: new Uint8Array(buffer),
    fileName: `${kind}-${code}.pdf`,
  };
}
