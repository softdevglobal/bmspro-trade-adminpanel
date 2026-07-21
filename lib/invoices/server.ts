import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import {
  completeBookingForInvoicedQuotation,
  type InvoicedBookingAudit,
} from "@/lib/bookings/server";
import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim, type AuditActor } from "@/lib/audit/types";
import { parseBookingStatus } from "@/lib/bookings/types";
import {
  getBusinessQuotationById,
  parseLineItems,
  serializeLineItemsForFirestore,
} from "@/lib/quotations/server";
import type {
  QuotationDepositRequest,
  QuotationLineItem,
} from "@/lib/quotations/types";
import { formatDepositPaymentNote } from "@/lib/quotations/document";
import { getBusinessProfile } from "@/lib/onboarding/server";
import { buildInvoiceCodeForQuotation } from "@/lib/reference-codes";
import { REQUESTS_COLLECTION } from "@/lib/inspection/types";
import { FieldValue } from "firebase-admin/firestore";
import type {
  CreateDirectInvoiceInput,
  CreateInvoiceInput,
  InvoiceDetail,
} from "@/lib/invoices/types";

export const INVOICE_COLLECTION = "invoices";
export const INVOICE_LIST_LIMIT = 80;

export type InvoiceAuthor = {
  uid: string;
  email?: string | null;
  role?: string | null;
};

async function resolveInvoiceAuthorActor(
  author: InvoiceAuthor,
): Promise<AuditActor> {
  const userSnap = await adminDb.collection("users").doc(author.uid).get();
  const userData = userSnap.exists ? userSnap.data() : null;
  const role = actorRoleFromClaim(author.role ?? userData?.role);
  return {
    uid: author.uid,
    role,
    name:
      userData && typeof userData.fullName === "string"
        ? userData.fullName
        : author.email ?? null,
    email: author.email ?? null,
  };
}

async function resolveInvoiceBookingAudit(
  author: InvoiceAuthor,
  invoiceCode: string | null,
  quotationCode: string | null,
): Promise<InvoicedBookingAudit> {
  return {
    actor: await resolveInvoiceAuthorActor(author),
    source: "admin_panel",
    invoiceCode,
    quotationCode,
  };
}

async function logInvoiceAuditEvent(
  businessId: string,
  author: InvoiceAuthor,
  invoice: InvoiceDetail,
  action: "invoice.created" | "invoice.sent",
): Promise<void> {
  const actor = await resolveInvoiceAuthorActor(author);
  const customerName = invoice.customer.fullName?.trim() || "a customer";
  const summary =
    action === "invoice.sent"
      ? `Invoice ${invoice.invoiceCode} sent to ${customerName}`
      : `Invoice ${invoice.invoiceCode} created for ${customerName}`;

  await logAuditEvent({
    businessId,
    category: "invoice",
    action,
    actor,
    source: "admin_panel",
    summary,
    targetId: invoice.id,
    targetLabel: invoice.invoiceCode || null,
    metadata: {
      invoiceCode: invoice.invoiceCode,
      quotationCode: invoice.quotationCode,
      quotationId: invoice.quotationId,
      finalPriceAud: invoice.finalPriceAud,
      status: invoice.status,
      bookingId: invoice.bookingId,
      bookingCode: invoice.bookingCode,
    },
  });
}

function parseDepositRequest(raw: unknown): QuotationDepositRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const mode = data.mode === "fixed" ? "fixed" : "percent";
  const amountAud =
    typeof data.amountAud === "number" && Number.isFinite(data.amountAud)
      ? data.amountAud
      : null;
  const dueDate = typeof data.dueDate === "string" ? data.dueDate.trim() : "";
  if (amountAud == null || amountAud <= 0 || !dueDate) return null;
  const percent =
    typeof data.percent === "number" && Number.isFinite(data.percent)
      ? data.percent
      : 0;
  return {
    mode,
    percent: mode === "percent" ? percent : 0,
    amountAud: Math.round(amountAud * 100) / 100,
    dueDate,
    paid: data.paid === true,
  };
}

function mapInvoiceDoc(id: string, data: Record<string, unknown>): InvoiceDetail {
  const lineItemsRaw = Array.isArray(data.lineItems) ? data.lineItems : [];
  const lineItems = lineItemsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const priceAud =
        typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
          ? item.priceAud
          : null;
      if (!name || priceAud == null || priceAud < 0) return null;
      return {
        name,
        priceAud,
        code: typeof item.code === "string" ? item.code : undefined,
        description:
          typeof item.description === "string" ? item.description : undefined,
        quantity:
          typeof item.quantity === "number" && Number.isFinite(item.quantity)
            ? item.quantity
            : undefined,
        rateAud:
          typeof item.rateAud === "number" && Number.isFinite(item.rateAud)
            ? item.rateAud
            : undefined,
        discountPercent:
          typeof item.discountPercent === "number" &&
          Number.isFinite(item.discountPercent)
            ? item.discountPercent
            : undefined,
        gstPercent:
          typeof item.gstPercent === "number" && Number.isFinite(item.gstPercent)
            ? item.gstPercent
            : undefined,
      } satisfies QuotationLineItem;
    })
    .filter((item) => item !== null) as QuotationLineItem[];

  const customerRaw = data.customer;
  const customer =
    customerRaw && typeof customerRaw === "object"
      ? {
          fullName:
            typeof (customerRaw as Record<string, unknown>).fullName === "string"
              ? ((customerRaw as Record<string, unknown>).fullName as string)
              : "",
          email:
            typeof (customerRaw as Record<string, unknown>).email === "string"
              ? ((customerRaw as Record<string, unknown>).email as string)
              : "",
          phone:
            typeof (customerRaw as Record<string, unknown>).phone === "string"
              ? ((customerRaw as Record<string, unknown>).phone as string)
              : "",
        }
      : { fullName: "", email: "", phone: "" };

  const addressRaw = data.address;
  const address =
    addressRaw && typeof addressRaw === "object"
      ? {
          street:
            typeof (addressRaw as Record<string, unknown>).street === "string"
              ? ((addressRaw as Record<string, unknown>).street as string)
              : "",
          suburb:
            typeof (addressRaw as Record<string, unknown>).suburb === "string"
              ? ((addressRaw as Record<string, unknown>).suburb as string)
              : "",
          state:
            typeof (addressRaw as Record<string, unknown>).state === "string"
              ? ((addressRaw as Record<string, unknown>).state as string)
              : "",
          postcode:
            typeof (addressRaw as Record<string, unknown>).postcode === "string"
              ? ((addressRaw as Record<string, unknown>).postcode as string)
              : "",
        }
      : { street: "", suburb: "", state: "", postcode: "" };

  const toMillis = (value: unknown): number | null => {
    if (value == null) return null;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "object" && value !== null && "toMillis" in value) {
      try {
        return (value as { toMillis: () => number }).toMillis();
      } catch {
        return null;
      }
    }
    return null;
  };

  return {
    id,
    invoiceCode:
      typeof data.invoiceCode === "string" ? data.invoiceCode : "",
    businessId: typeof data.businessId === "string" ? data.businessId : "",
    quotationId: typeof data.quotationId === "string" ? data.quotationId : "",
    quotationCode:
      typeof data.quotationCode === "string" ? data.quotationCode : null,
    inspectionRequestId:
      typeof data.inspectionRequestId === "string"
        ? data.inspectionRequestId
        : "",
    serviceTitle:
      typeof data.serviceTitle === "string" ? data.serviceTitle : "",
    customer,
    address,
    lineItems,
    subtotalAud:
      typeof data.subtotalAud === "number" && Number.isFinite(data.subtotalAud)
        ? data.subtotalAud
        : 0,
    discountAud:
      typeof data.discountAud === "number" && Number.isFinite(data.discountAud)
        ? data.discountAud
        : 0,
    gstAud:
      typeof data.gstAud === "number" && Number.isFinite(data.gstAud)
        ? data.gstAud
        : 0,
    gstPricing: data.gstPricing === "inclusive" ? "inclusive" : "exclusive",
    finalPriceAud:
      typeof data.finalPriceAud === "number" &&
      Number.isFinite(data.finalPriceAud)
        ? data.finalPriceAud
        : 0,
    balanceDueAud:
      typeof data.balanceDueAud === "number" &&
      Number.isFinite(data.balanceDueAud)
        ? data.balanceDueAud
        : typeof data.finalPriceAud === "number" &&
            Number.isFinite(data.finalPriceAud)
          ? data.finalPriceAud
          : 0,
    depositRequest: parseDepositRequest(data.depositRequest),
    bookingId: typeof data.bookingId === "string" ? data.bookingId : null,
    bookingCode:
      typeof data.bookingCode === "string" ? data.bookingCode : null,
    bookingStatus: parseBookingStatus(data.bookingStatus),
    bookingStatusAt: toMillis(data.bookingStatusAt),
    notes: typeof data.notes === "string" ? data.notes : null,
    termsAndConditions:
      typeof data.termsAndConditions === "string"
        ? data.termsAndConditions
        : null,
    invoiceDate:
      typeof data.invoiceDate === "string" ? data.invoiceDate : "",
    dueDate: typeof data.dueDate === "string" ? data.dueDate : "",
    status:
      data.status === "paid"
        ? "paid"
        : data.status === "sent"
          ? "sent"
          : data.status === "cancelled"
            ? "cancelled"
            : "draft",
    pdfUrl:
      typeof data.pdfUrl === "string" && data.pdfUrl.trim()
        ? data.pdfUrl.trim()
        : null,
    cancelledAt: toMillis(data.cancelledAt),
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Lists all invoices for a business (newest first). */
export async function listBusinessInvoices(
  businessId: string,
): Promise<InvoiceDetail[]> {
  // Filter-only query — avoids a composite index on businessId + createdAt.
  // Sort newest-first in memory (typical invoice volume is small).
  const snapshot = await adminDb
    .collection(INVOICE_COLLECTION)
    .where("businessId", "==", businessId)
    .get();

  return snapshot.docs
    .map((doc) => mapInvoiceDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, INVOICE_LIST_LIMIT);
}

export async function getBusinessInvoiceByQuotationId(
  businessId: string,
  quotationId: string,
): Promise<InvoiceDetail | null> {
  const snap = await adminDb
    .collection(INVOICE_COLLECTION)
    .doc(quotationId.trim())
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.businessId !== businessId) return null;
  return mapInvoiceDoc(snap.id, data);
}

async function generateInvoicePdfBytes(
  invoice: InvoiceDetail,
  businessId: string,
): Promise<Buffer | null> {
  const profile = await getBusinessProfile(businessId);
  try {
    const { generateInvoicePdf } = await import("@/lib/invoices/pdf");
    return await generateInvoicePdf(invoice, {
      businessName: profile?.businessName ?? null,
      logoUrl: profile?.logoUrl ?? null,
      businessAddress: profile?.businessAddress ?? null,
      businessEmail: profile?.businessEmail ?? null,
      businessPhone: profile?.businessPhone ?? null,
      abn: profile?.abn ?? null,
      registeredForGst: profile?.registeredForGst ?? false,
      gstPercentage: profile?.gstPercentage ?? null,
    });
  } catch (error) {
    console.error("[invoice] PDF generation failed:", error);
    return null;
  }
}

async function mirrorInvoiceToInspectionRequest(
  invoice: InvoiceDetail,
): Promise<void> {
  const requestId = invoice.inspectionRequestId?.trim();
  if (!requestId) return;

  const closesRequest = invoice.status === "sent" || invoice.status === "paid";
  const now = FieldValue.serverTimestamp();
  const requestPatch: Record<string, unknown> = {
    invoice: {
      id: invoice.id,
      invoiceCode: invoice.invoiceCode?.trim() || null,
      pdfUrl: invoice.pdfUrl?.trim() || null,
      finalPriceAud: invoice.finalPriceAud,
      balanceDueAud: invoice.balanceDueAud,
      status: invoice.status,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
    },
    updatedAt: now,
  };

  if (closesRequest) {
    requestPatch.status = "completed";
    requestPatch.bookingStatus = "completed";
    requestPatch.bookingStatusAt = now;
  }

  try {
    await adminDb
      .collection(REQUESTS_COLLECTION)
      .doc(requestId)
      .set(requestPatch, { merge: true });
  } catch (error) {
    console.error("[invoice] request mirror failed:", error);
  }
}

/** Generates an invoice PDF, uploads it, and persists the public URL on the doc. */
async function persistInvoicePdf(
  invoice: InvoiceDetail,
  businessId: string,
  pdfBytes?: Buffer | null,
): Promise<{ invoice: InvoiceDetail; pdfBytes: Buffer | null }> {
  if (invoice.pdfUrl?.trim()) {
    const bytes =
      pdfBytes?.length
        ? pdfBytes
        : await generateInvoicePdfBytes(invoice, businessId);
    return { invoice, pdfBytes: bytes };
  }

  const bytes = pdfBytes ?? (await generateInvoicePdfBytes(invoice, businessId));
  if (!bytes?.length) {
    return { invoice, pdfBytes: null };
  }

  try {
    const { uploadInvoicePdf } = await import("@/lib/onboarding/services/upload");
    const uploaded = await uploadInvoicePdf(bytes, {
      businessId,
      inspectionRequestId: invoice.inspectionRequestId,
      invoiceId: invoice.id,
    });
    if (!uploaded.ok) {
      return { invoice, pdfBytes: bytes };
    }

    await adminDb.collection(INVOICE_COLLECTION).doc(invoice.id).update({
      pdfUrl: uploaded.url,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      invoice: { ...invoice, pdfUrl: uploaded.url },
      pdfBytes: bytes,
    };
  } catch (error) {
    console.error("[invoice] PDF upload failed:", error);
    return { invoice, pdfBytes: bytes };
  }
}

/** Returns invoice PDF bytes for viewing or download. */
export async function getBusinessInvoicePdf(
  businessId: string,
  quotationId: string,
): Promise<
  | { ok: true; pdfBytes: Buffer; fileName: string }
  | { ok: false; status: number; error: string }
> {
  const invoice = await getBusinessInvoiceByQuotationId(businessId, quotationId);
  if (!invoice) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const { pdfBytes } = await persistInvoicePdf(invoice, businessId);
  if (!pdfBytes?.length) {
    return { ok: false, status: 500, error: "Could not generate invoice PDF." };
  }

  const invoiceCode = invoice.invoiceCode.trim() || "invoice";
  return {
    ok: true,
    pdfBytes,
    fileName: `${invoiceCode}.pdf`.replace(/[^a-z0-9.\-]+/gi, "-"),
  };
}

export async function markBusinessInvoicePaid(
  businessId: string,
  quotationId: string,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const id = quotationId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Invoice is required." };
  }

  const docRef = adminDb.collection(INVOICE_COLLECTION).doc(id);
  const snap = await docRef.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const invoice = mapInvoiceDoc(snap.id, snap.data() ?? {});
  if (invoice.status === "draft") {
    return {
      ok: false,
      status: 400,
      error: "Draft invoices must be sent before they can be marked paid.",
    };
  }
  if (invoice.status === "paid") {
    return { ok: true, invoice };
  }

  await docRef.update({
    status: "paid",
    balanceDueAud: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await docRef.get();
  const paidInvoice = mapInvoiceDoc(updated.id, updated.data() ?? {});
  await mirrorInvoiceToInspectionRequest(paidInvoice);
  return { ok: true, invoice: paidInvoice };
}

/**
 * Cancels an invoice without deleting it. Draft or sent invoices can be
 * cancelled; paid invoices cannot. The record is kept for reference and the
 * cancelled status is mirrored onto the linked request.
 */
export async function cancelBusinessInvoice(
  businessId: string,
  invoiceId: string,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const id = invoiceId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Invoice is required." };
  }

  const docRef = adminDb.collection(INVOICE_COLLECTION).doc(id);
  const snap = await docRef.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const invoice = mapInvoiceDoc(snap.id, snap.data() ?? {});
  if (invoice.status === "cancelled") {
    return { ok: true, invoice };
  }
  if (invoice.status === "paid") {
    return {
      ok: false,
      status: 400,
      error: "Paid invoices cannot be cancelled.",
    };
  }

  await docRef.update({
    status: "cancelled",
    cancelledFromStatus: invoice.status,
    cancelledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await docRef.get();
  const cancelledInvoice = mapInvoiceDoc(updated.id, updated.data() ?? {});
  await mirrorInvoiceToInspectionRequest(cancelledInvoice);
  return { ok: true, invoice: cancelledInvoice };
}

/**
 * Restores a cancelled invoice to its pre-cancellation status (draft or sent)
 * and re-mirrors it onto the linked request.
 */
export async function undoCancelBusinessInvoice(
  businessId: string,
  invoiceId: string,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const id = invoiceId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Invoice is required." };
  }

  const docRef = adminDb.collection(INVOICE_COLLECTION).doc(id);
  const snap = await docRef.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const data = snap.data() ?? {};
  const invoice = mapInvoiceDoc(snap.id, data);
  if (invoice.status !== "cancelled") {
    return {
      ok: false,
      status: 400,
      error: "Only cancelled invoices can be restored.",
    };
  }

  const restoredStatus = data.cancelledFromStatus === "sent" ? "sent" : "draft";

  await docRef.update({
    status: restoredStatus,
    cancelledFromStatus: FieldValue.delete(),
    cancelledAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updated = await docRef.get();
  const restoredInvoice = mapInvoiceDoc(updated.id, updated.data() ?? {});
  await mirrorInvoiceToInspectionRequest(restoredInvoice);
  return { ok: true, invoice: restoredInvoice };
}

function buildInvoiceValues(input: CreateInvoiceInput):
  | {
      ok: true;
      lineItems: QuotationLineItem[];
      subtotalAud: number;
      discountAud: number;
      gstAud: number;
      gstPricing: "exclusive" | "inclusive";
      finalPriceAud: number;
      balanceDueAud: number;
      depositRequest: QuotationDepositRequest | null;
      depositRequestData: Record<string, unknown> | null;
      termsAndConditions: string | null;
    }
  | { ok: false; status: number; error: string } {
  const lineItems = parseLineItems(input.lineItems);
  if (!lineItems || lineItems.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Add at least one line item.",
    };
  }

  const subtotalAud = lineItems.reduce((sum, item) => sum + item.priceAud, 0);
  const discountAud = Math.max(0, input.discountAud ?? 0);
  const gstAud = Math.max(0, input.gstAud ?? 0);
  const gstPricing =
    input.gstPricing === "inclusive" ? "inclusive" : "exclusive";
  const finalPriceAud = Math.max(0, input.finalPriceAud);

  const depositRequest = parseDepositRequest(input.depositRequest);
  // Only a deposit that has actually been received reduces the balance due;
  // otherwise the invoice is issued for the full amount.
  const depositAmount =
    depositRequest?.paid === true
      ? Math.min(depositRequest.amountAud, finalPriceAud)
      : 0;
  const balanceDueAud =
    Math.round(Math.max(0, finalPriceAud - depositAmount) * 100) / 100;
  const termsAndConditions = (() => {
    const baseTerms = input.termsAndConditions?.trim() || null;
    if (!depositRequest) return baseTerms;
    const depositNote = formatDepositPaymentNote(depositRequest);
    return baseTerms ? `${baseTerms}\n\n${depositNote}` : depositNote;
  })();

  return {
    ok: true,
    lineItems,
    subtotalAud,
    discountAud,
    gstAud,
    gstPricing,
    finalPriceAud,
    balanceDueAud,
    depositRequest,
    depositRequestData: depositRequest
      ? {
          mode: depositRequest.mode,
          percent: depositRequest.percent,
          amountAud: depositRequest.amountAud,
          dueDate: depositRequest.dueDate,
          paid: depositRequest.paid === true,
        }
      : null,
    termsAndConditions,
  };
}

export async function createInvoiceFromQuotation(
  businessId: string,
  author: InvoiceAuthor,
  input: CreateInvoiceInput,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const quotation = await getBusinessQuotationById(
    businessId,
    input.quotationId.trim(),
  );
  if (!quotation) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  const values = buildInvoiceValues(input);
  if (!values.ok) return values;

  const docRef = adminDb.collection(INVOICE_COLLECTION).doc(quotation.id);
  const existing = await docRef.get();
  if (existing.exists && existing.data()?.businessId === businessId) {
    const existingInvoice = mapInvoiceDoc(
      existing.id,
      existing.data() ?? {},
    );
    if (existingInvoice.status === "draft") {
      const canUpdateDirectDetails =
        quotation.createdSource === "invoice_direct";
      const customer =
        canUpdateDirectDetails && input.customer
          ? input.customer
          : quotation.customer;
      const address =
        canUpdateDirectDetails && input.address
          ? {
              street: input.address.street ?? "",
              suburb: input.address.suburb ?? "",
              state: input.address.state ?? "",
              postcode: input.address.postcode ?? "",
            }
          : quotation.address;
      const serviceTitle =
        canUpdateDirectDetails && input.serviceTitle?.trim()
          ? input.serviceTitle.trim()
          : quotation.serviceTitle;
      const booking = await completeBookingForInvoicedQuotation({
        businessId,
        inspectionRequestId: quotation.inspectionRequestId,
        quotation: {
          id: quotation.id,
          quotationCode: quotation.quotationCode,
          serviceTitle,
          customer,
          address,
          finalPriceAud: values.finalPriceAud,
          subtotalAud: values.subtotalAud,
          balanceDueAud: values.balanceDueAud,
          status: quotation.status,
        },
      });

      const now = FieldValue.serverTimestamp();
      await docRef.update({
        serviceTitle,
        customer,
        address,
        lineItems: serializeLineItemsForFirestore(values.lineItems),
        subtotalAud: values.subtotalAud,
        discountAud: values.discountAud,
        gstAud: values.gstAud,
        gstPricing: values.gstPricing,
        finalPriceAud: values.finalPriceAud,
        balanceDueAud: values.balanceDueAud,
        depositRequest: values.depositRequestData,
        notes: input.notes?.trim() || null,
        termsAndConditions: values.termsAndConditions,
        invoiceDate: input.invoiceDate.trim(),
        dueDate: input.dueDate.trim(),
        status: input.send ? "sent" : "draft",
        bookingId: booking?.bookingId ?? existingInvoice.bookingId,
        bookingCode: booking?.bookingCode ?? existingInvoice.bookingCode,
        bookingStatus: booking?.bookingStatus ?? existingInvoice.bookingStatus,
        bookingStatusAt: booking ? now : existingInvoice.bookingStatusAt,
        pdfUrl: null,
        updatedAt: now,
      });

      const saved = await docRef.get();
      let invoice = mapInvoiceDoc(saved.id, saved.data() ?? {});
      const persisted = await persistInvoicePdf(invoice, businessId);
      invoice = persisted.invoice;
      if (input.send) {
        await sendInvoiceEmailForDetail(
          invoice,
          businessId,
          persisted.pdfBytes,
        );
      }
      await mirrorInvoiceToInspectionRequest(invoice);
      return { ok: true, invoice };
    }

    if (!input.send) {
      return { ok: true, invoice: existingInvoice };
    }

    const booking = await completeBookingForInvoicedQuotation({
      businessId,
      inspectionRequestId: quotation.inspectionRequestId,
      quotation: {
        id: quotation.id,
        quotationCode: quotation.quotationCode,
        serviceTitle: quotation.serviceTitle,
        customer: quotation.customer,
        address: quotation.address,
        finalPriceAud: existingInvoice.finalPriceAud,
        subtotalAud: existingInvoice.subtotalAud,
        balanceDueAud: existingInvoice.balanceDueAud,
        status: quotation.status,
      },
      audit: await resolveInvoiceBookingAudit(
        author,
        existingInvoice.invoiceCode,
        quotation.quotationCode,
      ),
    });

    const resendPatch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (existingInvoice.status !== "sent") {
      resendPatch.status = "sent";
    }
    if (booking) {
      if (!existingInvoice.bookingId) {
        resendPatch.bookingId = booking.bookingId;
        resendPatch.bookingCode = booking.bookingCode;
      }
      if (!existingInvoice.bookingStatus) {
        resendPatch.bookingStatus = booking.bookingStatus;
        resendPatch.bookingStatusAt = FieldValue.serverTimestamp();
      }
    }
    await docRef.update(resendPatch);

    const sent = await docRef.get();
    let invoice = mapInvoiceDoc(sent.id, sent.data() ?? {});
    const persisted = await persistInvoicePdf(invoice, businessId);
    invoice = persisted.invoice;
    await sendInvoiceEmailForDetail(
      invoice,
      businessId,
      persisted.pdfBytes,
    );
    await mirrorInvoiceToInspectionRequest(invoice);
    await logInvoiceAuditEvent(businessId, author, invoice, "invoice.sent");
    return { ok: true, invoice };
  }

  if (quotation.status === "cancelled") {
    return {
      ok: false,
      status: 400,
      error: "Cancelled quotations cannot be invoiced.",
    };
  }

  if (
    quotation.status === "sent" &&
    quotation.customerDecision !== "accepted"
  ) {
    return {
      ok: false,
      status: 400,
      error:
        quotation.customerDecision === "rejected"
          ? "The customer rejected this quotation, so it cannot be invoiced."
          : "Wait for the customer to accept the quotation before issuing an invoice.",
    };
  }

  const invoiceCode = buildInvoiceCodeForQuotation(quotation);
  const now = FieldValue.serverTimestamp();

  // Mark (or create) the linked booking as completed.
  const booking = await completeBookingForInvoicedQuotation({
    businessId,
    inspectionRequestId: quotation.inspectionRequestId,
    quotation: {
      id: quotation.id,
      quotationCode: quotation.quotationCode,
      serviceTitle: quotation.serviceTitle,
      customer: quotation.customer,
      address: quotation.address,
      finalPriceAud: values.finalPriceAud,
      subtotalAud: values.subtotalAud,
      balanceDueAud: values.balanceDueAud,
      status: quotation.status,
    },
    audit: await resolveInvoiceBookingAudit(
      author,
      invoiceCode,
      quotation.quotationCode,
    ),
  });

  await docRef.set({
    invoiceCode,
    businessId,
    quotationId: quotation.id,
    quotationCode: quotation.quotationCode,
    inspectionRequestId: quotation.inspectionRequestId,
    serviceTitle: quotation.serviceTitle,
    customer: quotation.customer,
    address: quotation.address,
    lineItems: serializeLineItemsForFirestore(values.lineItems),
    subtotalAud: values.subtotalAud,
    discountAud: values.discountAud,
    gstAud: values.gstAud,
    gstPricing: values.gstPricing,
    finalPriceAud: values.finalPriceAud,
    balanceDueAud: values.balanceDueAud,
    depositRequest: values.depositRequestData,
    notes: input.notes?.trim() || null,
    termsAndConditions: values.termsAndConditions,
    invoiceDate: input.invoiceDate.trim(),
    dueDate: input.dueDate.trim(),
    status: input.send ? "sent" : "draft",
    bookingId: booking?.bookingId ?? null,
    bookingCode: booking?.bookingCode ?? null,
    bookingStatus: booking?.bookingStatus ?? null,
    bookingStatusAt: booking ? now : null,
    createdBy: author.uid,
    createdAt: now,
    updatedAt: now,
  });

  const saved = await docRef.get();
  let invoice = mapInvoiceDoc(saved.id, saved.data() ?? {});
  const persisted = await persistInvoicePdf(invoice, businessId);
  invoice = persisted.invoice;

  await logInvoiceAuditEvent(businessId, author, invoice, "invoice.created");

  if (input.send) {
    await sendInvoiceEmailForDetail(
      invoice,
      businessId,
      persisted.pdfBytes,
    );
    await logInvoiceAuditEvent(businessId, author, invoice, "invoice.sent");
  }

  await mirrorInvoiceToInspectionRequest(invoice);

  return {
    ok: true,
    invoice,
  };
}

/**
 * Creates an invoice directly (no existing quotation). The full record
 * chain is created so the work reads like any other completed job:
 * a completed request (`invoice_direct` source), an accepted quotation,
 * a completed job, and finally the invoice itself.
 */
export async function createDirectInvoice(
  businessId: string,
  uid: string,
  input: CreateDirectInvoiceInput,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const serviceTitle = (input.serviceTitle ?? "").trim();
  const description =
    input.description?.trim() ||
    `Direct invoice issued for completed work: ${serviceTitle || "job"}.`;

  const { createStandaloneQuotation } = await import(
    "@/lib/quotations/server"
  );
  const created = await createStandaloneQuotation(businessId, uid, {
    customer: input.customer,
    address: {
      street: input.address.street ?? "",
      suburb: input.address.suburb ?? "",
      state: input.address.state ?? "",
      postcode: input.address.postcode ?? "",
    },
    title: serviceTitle,
    description,
    requestType: input.requestType,
    serviceId: input.serviceId,
    customRequest: input.customRequest,
    lineItems: input.lineItems,
    finalPriceAud: input.finalPriceAud,
    discountAud: input.discountAud,
    depositRequest: input.depositRequest,
    notes: input.notes,
    termsAndConditions: input.termsAndConditions,
    send: false,
    createdSource: "invoice_direct",
  });
  if (!created.ok) return created;

  const quotation = created.quotation;

  // The work is already agreed and done, so record the quotation as sent
  // and accepted — the same end state as a normal quote-to-invoice flow.
  const now = FieldValue.serverTimestamp();
  await adminDb
    .collection("quotations")
    .doc(quotation.id)
    .set(
      {
        status: "sent",
        customerDecision: "accepted",
        customerDecisionAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  await adminDb
    .collection("requests")
    .doc(quotation.inspectionRequestId)
    .set(
      {
        quotation: {
          status: "sent",
          customerDecision: "accepted",
          customerDecisionAt: now,
        },
        updatedAt: now,
      },
      { merge: true },
    );

  return createInvoiceFromQuotation(businessId, { uid }, {
    quotationId: quotation.id,
    lineItems: input.lineItems,
    finalPriceAud: input.finalPriceAud,
    discountAud: input.discountAud,
    gstAud: input.gstAud,
    gstPricing: input.gstPricing,
    depositRequest: input.depositRequest,
    notes: input.notes,
    termsAndConditions: input.termsAndConditions,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    send: input.send,
  });
}

async function sendInvoiceEmailForDetail(
  invoice: InvoiceDetail,
  businessId: string,
  pdfBytes?: Buffer | null,
): Promise<void> {
  const email = invoice.customer.email?.trim();
  if (!email) return;

  const profile = await getBusinessProfile(businessId);

  const bytes =
    pdfBytes?.length
      ? pdfBytes
      : await generateInvoicePdfBytes(invoice, businessId);

  if (!bytes?.length) return;

  const { sendInvoiceSentEmail } = await import(
    "@/lib/email/templates/invoice-sent"
  );

  const invoiceCode = invoice.invoiceCode.trim() || "invoice";

  await sendInvoiceSentEmail({
    customerEmail: email,
    customerPhone: invoice.customer.phone ?? null,
    customerFullName: invoice.customer.fullName,
    invoiceNo: invoice.invoiceCode,
    serviceTitle: invoice.serviceTitle,
    dueDate: invoice.dueDate,
    totalAud: invoice.finalPriceAud,
    balanceDueAud: invoice.balanceDueAud,
    depositRequest: invoice.depositRequest,
    businessName: profile?.businessName ?? null,
    bookingSlug: profile?.bookingSlug ?? null,
    logoUrl: profile?.logoUrl ?? null,
    businessId,
    pdfBytes: bytes,
    pdfFileName: `${invoiceCode}.pdf`.replace(/[^a-z0-9.\-]+/gi, "-"),
  });

  const { notifyCustomerOfInvoiceSent } = await import(
    "@/lib/notifications/server"
  );
  await notifyCustomerOfInvoiceSent(businessId, {
    id: invoice.id,
    invoiceCode: invoice.invoiceCode,
    inspectionRequestId: invoice.inspectionRequestId,
    serviceTitle: invoice.serviceTitle,
    customer: invoice.customer,
    finalPriceAud: invoice.finalPriceAud,
    balanceDueAud: invoice.balanceDueAud,
    dueDate: invoice.dueDate,
  }, {
    businessName: profile?.businessName ?? null,
    bookingSlug: profile?.bookingSlug ?? null,
    logoUrl: profile?.logoUrl ?? null,
    timezone: profile?.timezone ?? null,
  });
}

/** Permanently removes an invoice and clears its mirror on the linked request. */
export async function deleteBusinessInvoice(
  businessId: string,
  invoiceId: string,
): Promise<
  | { ok: true; invoice: InvoiceDetail }
  | { ok: false; status: number; error: string }
> {
  const id = invoiceId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Invoice is required." };
  }

  const docRef = adminDb.collection(INVOICE_COLLECTION).doc(id);
  const snap = await docRef.get();
  if (!snap.exists || snap.data()?.businessId !== businessId) {
    return { ok: false, status: 404, error: "Invoice not found." };
  }

  const invoice = mapInvoiceDoc(snap.id, snap.data() ?? {});
  const requestId = invoice.inspectionRequestId?.trim();

  await docRef.delete();

  if (requestId) {
    try {
      const requestRef = adminDb.collection(REQUESTS_COLLECTION).doc(requestId);
      const requestSnap = await requestRef.get();
      if (requestSnap.exists) {
        const requestData = requestSnap.data() ?? {};
        const summary = requestData.invoice as { id?: string } | null | undefined;
        if (requestData.businessId === businessId && summary?.id === id) {
          await requestRef.update({
            invoice: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    } catch (error) {
      console.error("[invoice] request cleanup failed:", error);
    }
  }

  return { ok: true, invoice };
}
