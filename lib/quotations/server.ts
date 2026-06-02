import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import {
  parseBookingStatus,
  type BookingStatus,
} from "@/lib/bookings/types";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { notifyCustomerOfStatusChange } from "@/lib/notifications/server";
import {
  type InspectionAddress,
  type InspectionCustomer,
} from "@/lib/inspection/types";
import { buildQuotationCodeForInspection } from "@/lib/reference-codes";
import { toMillis } from "@/lib/onboarding/services/display";
import { FieldValue } from "firebase-admin/firestore";

export const QUOTATION_COLLECTION = "quotations";

export type QuotationLineItem = {
  name: string;
  priceAud: number;
};

/** Extra charges (e.g. labour, call-out fee) added on top of item subtotal. */
export type QuotationAddition = {
  name: string;
  priceAud: number;
};

export type QuotationDetail = {
  id: string;
  quotationCode: string | null;
  businessId: string;
  inspectionRequestId: string;
  serviceTitle: string;
  customer: InspectionCustomer;
  address: InspectionAddress;
  lineItems: QuotationLineItem[];
  additions: QuotationAddition[];
  subtotalAud: number;
  additionsTotalAud: number;
  finalPriceAud: number;
  notes: string | null;
  validUntil: string | null;
  imageUrls: string[];
  pdfUrl: string | null;
  status: "draft" | "sent";
  bookingId: string | null;
  bookingCode: string | null;
  bookingStatus: BookingStatus | null;
  bookingStatusAt: number | null;
  createdBy: string;
  createdAt: number | null;
  updatedAt: number | null;
};

export type CreateQuotationInput = {
  inspectionRequestId: string;
  lineItems: QuotationLineItem[];
  additions?: QuotationAddition[];
  finalPriceAud?: number | null;
  notes?: string | null;
  validUntil?: string | null;
  imageUrls?: string[];
};

function parseImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (url): url is string =>
        typeof url === "string" &&
        url.trim().startsWith("http") &&
        url.trim().length <= 2048,
    )
    .map((url) => url.trim())
    .slice(0, 10);
}

function mapQuotationDoc(
  id: string,
  data: Record<string, unknown>,
): QuotationDetail {
  const lineItemsRaw = Array.isArray(data.lineItems) ? data.lineItems : [];
  const lineItems = lineItemsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const name =
        typeof item.name === "string"
          ? item.name.trim()
          : typeof item.description === "string"
            ? item.description.trim()
            : "";
      const priceAud =
        typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
          ? item.priceAud
          : typeof item.amountAud === "number" && Number.isFinite(item.amountAud)
            ? item.amountAud
            : null;
      if (!name || priceAud == null || priceAud < 0) return null;
      return { name, priceAud };
    })
    .filter((item): item is QuotationLineItem => item !== null);

  const additionsRaw = Array.isArray(data.additions) ? data.additions : [];
  const additions = additionsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const priceAud =
        typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
          ? item.priceAud
          : null;
      if (!name || priceAud == null || priceAud < 0) return null;
      return { name, priceAud };
    })
    .filter((item): item is QuotationAddition => item !== null);

  const customerRaw = data.customer;
  const customer =
    customerRaw && typeof customerRaw === "object"
      ? {
          fullName:
            typeof (customerRaw as Record<string, unknown>).fullName ===
            "string"
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
    quotationCode:
      typeof data.quotationCode === "string" && data.quotationCode.trim()
        ? data.quotationCode.trim()
        : null,
    businessId: typeof data.businessId === "string" ? data.businessId : "",
    inspectionRequestId:
      typeof data.inspectionRequestId === "string"
        ? data.inspectionRequestId
        : "",
    serviceTitle:
      typeof data.serviceTitle === "string" ? data.serviceTitle : "",
    customer,
    address,
    lineItems,
    additions,
    subtotalAud:
      typeof data.subtotalAud === "number" && Number.isFinite(data.subtotalAud)
        ? data.subtotalAud
        : 0,
    additionsTotalAud:
      typeof data.additionsTotalAud === "number" &&
      Number.isFinite(data.additionsTotalAud)
        ? data.additionsTotalAud
        : additions.reduce((sum, item) => sum + item.priceAud, 0),
    finalPriceAud:
      typeof data.finalPriceAud === "number" &&
      Number.isFinite(data.finalPriceAud)
        ? data.finalPriceAud
        : typeof data.subtotalAud === "number" &&
            Number.isFinite(data.subtotalAud)
          ? data.subtotalAud
          : 0,
    notes: typeof data.notes === "string" ? data.notes : null,
    validUntil:
      typeof data.validUntil === "string" ? data.validUntil : null,
    imageUrls: parseImageUrls(data.imageUrls),
    pdfUrl:
      typeof data.pdfUrl === "string" && data.pdfUrl.trim()
        ? data.pdfUrl.trim()
        : null,
    status: data.status === "sent" ? "sent" : "draft",
    bookingId: typeof data.bookingId === "string" ? data.bookingId : null,
    bookingCode:
      typeof data.bookingCode === "string" && data.bookingCode.trim()
        ? data.bookingCode.trim()
        : null,
    bookingStatus: (() => {
      const parsed = parseBookingStatus(data.bookingStatus);
      if (parsed) return parsed;
      if (typeof data.bookingId === "string" && data.bookingId.trim()) {
        return "scheduled";
      }
      return null;
    })(),
    bookingStatusAt: toMillis(data.bookingStatusAt),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

function requestHeadline(data: Record<string, unknown>): string {
  const requestType = data.requestType;
  if (requestType === "existing_service") {
    return typeof data.serviceName === "string" && data.serviceName.trim()
      ? data.serviceName.trim()
      : "Service request";
  }
  const custom = data.customRequest;
  if (custom && typeof custom === "object") {
    const title = (custom as Record<string, unknown>).title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return "Custom quotation request";
}

function parseLineItems(raw: unknown): QuotationLineItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: QuotationLineItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as Record<string, unknown>;
    const name =
      typeof item.name === "string"
        ? item.name.trim()
        : typeof item.description === "string"
          ? item.description.trim()
          : "";
    const priceAud =
      typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
        ? item.priceAud
        : typeof item.amountAud === "number" && Number.isFinite(item.amountAud)
          ? item.amountAud
          : null;
    if (!name || priceAud == null || priceAud < 0) return null;
    items.push({ name, priceAud });
  }
  return items;
}

/** Parses optional additions (extra charges). Invalid rows are dropped. */
function parseAdditions(raw: unknown): QuotationAddition[] {
  if (!Array.isArray(raw)) return [];
  const additions: QuotationAddition[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const priceAud =
      typeof item.priceAud === "number" && Number.isFinite(item.priceAud)
        ? item.priceAud
        : null;
    if (!name || priceAud == null || priceAud < 0) continue;
    additions.push({ name, priceAud });
  }
  return additions;
}

type QuotationBusinessBranding = {
  businessName: string | null;
  bookingSlug: string | null;
  logoUrl: string | null;
};

async function loadQuotationBusinessBranding(
  businessId: string,
): Promise<QuotationBusinessBranding> {
  try {
    const businessSnap = await adminDb.collection("businesses").doc(businessId).get();
    const businessData = businessSnap.data() ?? {};
    return {
      businessName:
        typeof businessData.businessName === "string"
          ? businessData.businessName
          : null,
      bookingSlug:
        typeof businessData.bookingSlug === "string"
          ? businessData.bookingSlug
          : null,
      logoUrl:
        typeof businessData.logoUrl === "string" ? businessData.logoUrl : null,
    };
  } catch {
    return { businessName: null, bookingSlug: null, logoUrl: null };
  }
}

export async function createQuotationForInspection(
  businessId: string,
  createdBy: string,
  input: CreateQuotationInput,
): Promise<
  | { ok: true; quotation: QuotationDetail }
  | { ok: false; status: number; error: string }
> {
  const inspectionId = input.inspectionRequestId.trim();
  if (!inspectionId) {
    return { ok: false, status: 400, error: "Missing inspection request." };
  }

  const lineItems = parseLineItems(input.lineItems);
  if (!lineItems || lineItems.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Add at least one line item with a name and price.",
    };
  }

  const requestSnap = await adminDb
    .collection("inspection_requests")
    .doc(inspectionId)
    .get();
  if (!requestSnap.exists) {
    return { ok: false, status: 404, error: "Inspection request not found." };
  }

  const requestData = requestSnap.data() ?? {};
  if (requestData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Inspection request not found." };
  }

  const assigned = requestData.assignedTo as { uid?: string } | null;
  const isAssigned = assigned?.uid === createdBy;
  if (!isAssigned) {
    return {
      ok: false,
      status: 403,
      error: "You can only create quotations for visits assigned to you.",
    };
  }

  const additions = parseAdditions(input.additions);
  const subtotalAud = lineItems.reduce((sum, item) => sum + item.priceAud, 0);
  const additionsTotalAud = additions.reduce(
    (sum, item) => sum + item.priceAud,
    0,
  );
  const computedFinal = subtotalAud + additionsTotalAud;
  const finalPriceAud =
    typeof input.finalPriceAud === "number" &&
    Number.isFinite(input.finalPriceAud) &&
    input.finalPriceAud >= 0
      ? input.finalPriceAud
      : computedFinal;
  const imageUrls = parseImageUrls(input.imageUrls);
  const ref = adminDb.collection(QUOTATION_COLLECTION).doc();
  const quotationCode = buildQuotationCodeForInspection({
    id: inspectionId,
    requestCode:
      typeof requestData.requestCode === "string"
        ? requestData.requestCode
        : null,
  });

  await ref.set({
    quotationCode,
    businessId,
    inspectionRequestId: inspectionId,
    serviceTitle: requestHeadline(requestData),
    customer: requestData.customer ?? {},
    address: requestData.address ?? {},
    lineItems,
    additions,
    subtotalAud,
    additionsTotalAud,
    finalPriceAud,
    imageUrls,
    notes:
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.trim()
        : null,
    validUntil:
      typeof input.validUntil === "string" && input.validUntil.trim()
        ? input.validUntil.trim()
        : null,
    status: "draft",
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const saved = await ref.get();
  let quotation = mapQuotationDoc(ref.id, saved.data() ?? {});

  const businessBranding = await loadQuotationBusinessBranding(businessId);

  // Generate a branded PDF, upload to storage, and persist its URL.
  let pdfBytes: Buffer | null = null;
  try {
    const { generateQuotationPdf } = await import("@/lib/quotations/pdf");
    const { uploadQuotationPdf } = await import(
      "@/lib/onboarding/services/upload"
    );
    pdfBytes = await generateQuotationPdf(quotation, {
      businessName: businessBranding.businessName,
      logoUrl: businessBranding.logoUrl,
      inspectionRequestCode:
        typeof requestData.requestCode === "string"
          ? requestData.requestCode
          : null,
    });
    const uploaded = await uploadQuotationPdf(pdfBytes, {
      businessId,
      inspectionRequestId: inspectionId,
      quotationId: ref.id,
    });
    if (uploaded.ok) {
      await ref.set(
        { pdfUrl: uploaded.url, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      quotation = { ...quotation, pdfUrl: uploaded.url };
    }
  } catch (error) {
    console.error("quotation PDF generation failed:", error);
  }

  // Mirror quotation onto the inspection request and mark the visit complete.
  try {
    const currentStatus =
      typeof requestData.status === "string" ? requestData.status : "";
    const shouldComplete =
      currentStatus === "scheduled" || currentStatus === "owner_proposed";

    await requestSnap.ref.set(
      {
        quotation: {
          id: ref.id,
          quotationCode,
          finalPriceAud,
          subtotalAud,
          additionsTotalAud,
          pdfUrl: quotation.pdfUrl ?? null,
          status: "sent",
          createdAt: FieldValue.serverTimestamp(),
        },
        ...(shouldComplete ? { status: "completed" as const } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await ref.set(
      { status: "sent", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    quotation = { ...quotation, status: "sent" };

    if (shouldComplete) {
      const after = await requestSnap.ref.get();
      const updatedRequest = mapInspectionDoc(
        inspectionId,
        after.data() ?? {},
      );
      const businessSnap = await adminDb
        .collection("businesses")
        .doc(businessId)
        .get();
      const businessData = businessSnap.data() ?? {};
      await notifyCustomerOfStatusChange(updatedRequest, "completed", {
        businessName:
          typeof businessData.businessName === "string"
            ? businessData.businessName
            : null,
        bookingSlug:
          typeof businessData.bookingSlug === "string"
            ? businessData.bookingSlug
            : null,
        logoUrl:
          typeof businessData.logoUrl === "string" ? businessData.logoUrl : null,
      });
    }
  } catch (error) {
    console.error("quotation mirror to inspection request failed:", error);
  }

  // Auto-save line items to the business item catalog for future reuse.
  try {
    const { upsertCatalogItems } = await import("@/lib/items/server");
    await upsertCatalogItems(businessId, createdBy, lineItems);
  } catch {
    /* catalog auto-save is best-effort */
  }

  await sendQuotationCreatedEmail(
    requestData,
    quotation,
    pdfBytes,
    businessBranding,
  );

  return { ok: true, quotation };
}

/** Lists quotations for an inspection request (admin viewing). */
export async function listQuotationsForInspection(
  businessId: string,
  inspectionRequestId: string,
): Promise<QuotationDetail[]> {
  const id = inspectionRequestId.trim();
  if (!id) return [];

  const [snap, inspectionSnap] = await Promise.all([
    adminDb
      .collection(QUOTATION_COLLECTION)
      .where("businessId", "==", businessId)
      .where("inspectionRequestId", "==", id)
      .get(),
    adminDb.collection("inspection_requests").doc(id).get(),
  ]);

  const inspectionData = inspectionSnap.data() ?? {};
  const fallbackBookingId =
    typeof inspectionData.bookingId === "string" ? inspectionData.bookingId : null;
  const fallbackBookingCode =
    typeof inspectionData.bookingCode === "string"
      ? inspectionData.bookingCode
      : null;
  const fallbackBookingStatus =
    parseBookingStatus(inspectionData.bookingStatus) ??
    (fallbackBookingId
      ? ("scheduled" as const)
      : inspectionData.status === "awaiting_decision"
        ? ("awaiting" as const)
        : null);
  const fallbackBookingStatusAt = toMillis(inspectionData.bookingStatusAt);

  return snap.docs
    .map((doc) => {
      const quotation = mapQuotationDoc(doc.id, doc.data() ?? {});
      const needsBookingId = !quotation.bookingId && fallbackBookingId;
      const needsBookingStatus =
        fallbackBookingStatus &&
        (!quotation.bookingStatus || !quotation.bookingStatusAt);
      if (!needsBookingId && !needsBookingStatus) return quotation;
      return {
        ...quotation,
        ...(needsBookingId
          ? {
              bookingId: fallbackBookingId,
              bookingCode: quotation.bookingCode ?? fallbackBookingCode,
            }
          : {}),
        ...(needsBookingStatus
          ? {
              bookingStatus: quotation.bookingStatus ?? fallbackBookingStatus,
              bookingStatusAt:
                quotation.bookingStatusAt ?? fallbackBookingStatusAt,
            }
          : {}),
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

async function sendQuotationCreatedEmail(
  requestData: Record<string, unknown>,
  quotation: QuotationDetail,
  pdfBytes: Buffer | null,
  businessBranding: QuotationBusinessBranding,
): Promise<void> {
  const customer = quotation.customer;
  const email = customer.email?.trim();
  if (!email) return;

  const { sendQuotationSentEmail } = await import(
    "@/lib/email/templates/quotation-sent"
  );

  const scheduledSlot = requestData.scheduledSlot as
    | { date?: string; timeRange?: string }
    | null
    | undefined;

  const { businessName, bookingSlug, logoUrl } = businessBranding;

  await sendQuotationSentEmail({
    customerEmail: email,
    customerFullName: customer.fullName,
    serviceTitle: quotation.serviceTitle,
    inspectionRequestId: quotation.inspectionRequestId,
    address: quotation.address,
    scheduledSlot,
    scheduledStartTime:
      typeof requestData.scheduledStartTime === "string"
        ? requestData.scheduledStartTime
        : null,
    scheduledEndTime:
      typeof requestData.scheduledEndTime === "string"
        ? requestData.scheduledEndTime
        : null,
    lineItems: quotation.lineItems,
    additions: quotation.additions,
    subtotalAud: quotation.subtotalAud,
    finalPriceAud: quotation.finalPriceAud,
    notes: quotation.notes,
    businessName,
    bookingSlug,
    logoUrl,
    pdfBytes,
    pdfFileName: `quotation-${quotation.serviceTitle || "bmspro"}.pdf`
      .replace(/[^a-z0-9.\-]+/gi, "-")
      .toLowerCase(),
  });
}
