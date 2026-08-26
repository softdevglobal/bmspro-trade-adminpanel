import type { User } from "firebase/auth";

async function fetchAuthorizedPdfBytes(
  user: User,
  path: string,
  errorMessage: string,
): Promise<Uint8Array> {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(errorMessage);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Loads invoice PDF bytes through the admin API (avoids Firebase Storage CORS). */
export async function fetchAdminInvoicePdfBytes(
  user: User,
  invoiceId: string,
): Promise<Uint8Array> {
  return fetchAuthorizedPdfBytes(
    user,
    `/api/invoices/pdf?quotationId=${encodeURIComponent(invoiceId)}`,
    "Could not load invoice PDF.",
  );
}

/** Loads quotation PDF bytes through the admin API (avoids Firebase Storage CORS). */
export async function fetchAdminQuotationPdfBytes(
  user: User,
  quotationId: string,
): Promise<Uint8Array> {
  return fetchAuthorizedPdfBytes(
    user,
    `/api/quotations/pdf?quotationId=${encodeURIComponent(quotationId)}`,
    "Could not load quotation PDF.",
  );
}

/** Loads item document bytes through the admin API (avoids Firebase Storage CORS). */
export async function fetchAdminItemDocumentBytes(
  user: User,
  itemId: string,
): Promise<Uint8Array> {
  return fetchAuthorizedPdfBytes(
    user,
    `/api/items/document?itemId=${encodeURIComponent(itemId)}`,
    "Could not load item document.",
  );
}
