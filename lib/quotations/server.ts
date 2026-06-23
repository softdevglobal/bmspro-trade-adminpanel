import "server-only";

import { logQuotationAuditForActor } from "@/lib/audit/action-logs";
import { adminDb } from "@/lib/firebase/admin";
import { parseBookingStatus } from "@/lib/bookings/types";
import type {
  CreateQuotationInput,
  QuotationDepositRequest,
  QuotationDetail,
  QuotationLineItem,
  QuotationStatus,
} from "@/lib/quotations/types";
export type {
  CreateQuotationInput,
  QuotationDepositRequest,
  QuotationDetail,
  QuotationLineItem,
} from "@/lib/quotations/types";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import {
  REQUESTS_COLLECTION,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionRequestCreatedSource,
  type InspectionRequestStatus,
  type InspectionRequestType,
  type InspectionSlot,
  REQUEST_STATUSES,
  parseCreatedSource,
} from "@/lib/inspection/types";
import { ensureCustomerAccount } from "@/lib/customer/server";
import {
  customerOwnsRequestRecord,
  type CustomerOwnershipIdentity,
} from "@/lib/customer/ownership";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  buildQuotationCodeForInspection,
  displayQuotationCode,
} from "@/lib/reference-codes";
import { allocateInspectionRequestCode } from "@/lib/reference-codes.server";
import { FieldValue } from "firebase-admin/firestore";
import { PLATFORM_TIME_ZONE } from "@/lib/platform/timezone";

export const QUOTATION_COLLECTION = "quotations";

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

function parseQuotationStatus(raw: unknown): QuotationStatus {
  if (raw === "sent" || raw === "cancelled") return raw;
  return "draft";
}

function parseRestorableQuotationStatus(
  raw: unknown,
): Exclude<QuotationStatus, "cancelled"> | null {
  if (raw === "sent" || raw === "draft") return raw;
  return null;
}

function parseDepositRequest(raw: unknown): QuotationDepositRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const mode = data.mode === "fixed" ? "fixed" : data.mode === "percent" ? "percent" : null;
  const amountAud =
    typeof data.amountAud === "number" && Number.isFinite(data.amountAud)
      ? data.amountAud
      : null;
  const dueDate =
    typeof data.dueDate === "string" && data.dueDate.trim()
      ? data.dueDate.trim()
      : null;
  if (!mode || amountAud == null || amountAud <= 0 || !dueDate) return null;
  const percent =
    typeof data.percent === "number" && Number.isFinite(data.percent)
      ? Math.min(100, Math.max(0, data.percent))
      : 0;
  return { mode, percent, amountAud, dueDate };
}

function computeBalanceDueAud(
  finalPriceAud: number,
): number {
  return Math.max(0, Math.round(finalPriceAud * 100) / 100);
}

/** Persisted when a quote is sent and no job booking exists yet. */
function awaitingBookingFields(): {
  bookingStatus: "awaiting";
  bookingStatusAt: FieldValue;
} {
  return {
    bookingStatus: "awaiting",
    bookingStatusAt: FieldValue.serverTimestamp(),
  };
}

function depositPaymentNote(deposit: QuotationDepositRequest): string {
  const amount = deposit.amountAud.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const [y, m, d] = deposit.dueDate.split("-");
  const due =
    y && m && d
      ? `${d.padStart(2, "0")}/${m.padStart(2, "0")}/${y}`
      : deposit.dueDate;
  const basis =
    deposit.mode === "percent" && deposit.percent > 0
      ? `${deposit.percent}% deposit`
      : "Deposit";
  return `${basis}: $${amount} due by ${due}.`;
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
      const readOptionalString = (value: unknown): string | undefined =>
        typeof value === "string" && value.trim() ? value.trim() : undefined;
      const readOptionalNumber = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) ? value : undefined;
      return {
        name,
        priceAud,
        code: readOptionalString(item.code),
        description: readOptionalString(item.description),
        quantity: readOptionalNumber(item.quantity),
        rateAud: readOptionalNumber(item.rateAud),
        gstPercent: readOptionalNumber(item.gstPercent),
      };
    })
    .filter((item) => item !== null) as QuotationLineItem[];

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

  const depositRequest = parseDepositRequest(data.depositRequest);
  const finalPriceAud =
    typeof data.finalPriceAud === "number" &&
    Number.isFinite(data.finalPriceAud)
      ? data.finalPriceAud
      : typeof data.subtotalAud === "number" &&
          Number.isFinite(data.subtotalAud)
        ? data.subtotalAud
        : 0;
  const balanceDueAud =
    typeof data.balanceDueAud === "number" &&
    Number.isFinite(data.balanceDueAud)
      ? Math.max(0, data.balanceDueAud)
      : computeBalanceDueAud(finalPriceAud);

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
    serviceDescription:
      typeof data.serviceDescription === "string" && data.serviceDescription.trim()
        ? data.serviceDescription.trim()
        : null,
    customer,
    address,
    lineItems,
    subtotalAud:
      typeof data.subtotalAud === "number" && Number.isFinite(data.subtotalAud)
        ? data.subtotalAud
        : 0,
    finalPriceAud,
    balanceDueAud,
    notes: typeof data.notes === "string" ? data.notes : null,
    paymentInstructions:
      typeof data.paymentInstructions === "string"
        ? data.paymentInstructions
        : null,
    termsAndConditions:
      typeof data.termsAndConditions === "string"
        ? data.termsAndConditions
        : null,
    discountAud:
      typeof data.discountAud === "number" && Number.isFinite(data.discountAud)
        ? Math.max(0, data.discountAud)
        : 0,
    depositRequest,
    validUntil:
      typeof data.validUntil === "string" ? data.validUntil : null,
    imageUrls: parseImageUrls(data.imageUrls),
    pdfUrl:
      typeof data.pdfUrl === "string" && data.pdfUrl.trim()
        ? data.pdfUrl.trim()
        : null,
    status: parseQuotationStatus(data.status),
    cancelledFromStatus: parseRestorableQuotationStatus(
      data.cancelledFromStatus,
    ),
    customerDecision:
      data.customerDecision === "accepted" ||
      data.customerDecision === "rejected"
        ? data.customerDecision
        : null,
    customerDecisionAt: toMillis(data.customerDecisionAt),
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
      if (data.status === "sent") {
        return "awaiting";
      }
      return null;
    })(),
    bookingStatusAt: toMillis(data.bookingStatusAt),
    invoiceId: null,
    invoiceCode: null,
    invoiceStatus: null,
    invoicePdfUrl: null,
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

function requestJobDescription(data: Record<string, unknown>): string | null {
  if (data.requestType !== "custom_quote") return null;
  const custom = data.customRequest;
  if (!custom || typeof custom !== "object") return null;
  const description = (custom as Record<string, unknown>).description;
  return typeof description === "string" && description.trim()
    ? description.trim()
    : null;
}

function normalizeServiceDescription(
  raw: string | null | undefined,
): string | null | undefined {
  if (typeof raw === "string") return raw.trim() || null;
  return raw === null ? null : undefined;
}

export function parseLineItems(raw: unknown): QuotationLineItem[] | null {
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
    const readOptionalString = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    const readOptionalNumber = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    items.push({
      name,
      priceAud,
      code: readOptionalString(item.code),
      description: readOptionalString(item.description),
      quantity: readOptionalNumber(item.quantity),
      rateAud: readOptionalNumber(item.rateAud),
      discountPercent: readOptionalNumber(item.discountPercent),
      gstPercent: readOptionalNumber(item.gstPercent),
    });
  }
  return items;
}

function serializeLineItemForFirestore(item: QuotationLineItem) {
  return {
    name: item.name,
    priceAud: item.priceAud,
    code: item.code?.trim() || null,
    description: item.description?.trim() || null,
    quantity: typeof item.quantity === "number" ? item.quantity : null,
    rateAud: typeof item.rateAud === "number" ? item.rateAud : null,
    discountPercent:
      typeof item.discountPercent === "number" ? item.discountPercent : null,
    gstPercent: typeof item.gstPercent === "number" ? item.gstPercent : null,
  };
}

export function serializeLineItemsForFirestore(items: QuotationLineItem[]) {
  return items.map(serializeLineItemForFirestore);
}

type QuotationBusinessBranding = {
  businessName: string | null;
  bookingSlug: string | null;
  bookingPath: string | null;
  logoUrl: string | null;
  businessAddress: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  abn: string | null;
  registeredForGst: boolean;
  gstPercentage: number | null;
  timezone: string;
};

async function loadQuotationBusinessBranding(
  businessId: string,
): Promise<QuotationBusinessBranding> {
  try {
    const businessSnap = await adminDb.collection("businesses").doc(businessId).get();
    const businessData = businessSnap.data() ?? {};
    const registeredForGst = Boolean(businessData.registeredForGst);
    const gstRaw = businessData.gstPercentage;
    const gstPercentage =
      typeof gstRaw === "number" && Number.isFinite(gstRaw) ? gstRaw : 10;
    const slug =
      typeof businessData.bookingSlug === "string"
        ? businessData.bookingSlug
        : null;
    return {
      businessName:
        typeof businessData.businessName === "string"
          ? businessData.businessName
          : null,
      bookingSlug: slug,
      bookingPath:
        typeof businessData.bookingPath === "string"
          ? businessData.bookingPath
          : slug
            ? `/booknow/${slug}`
            : null,
      logoUrl:
        typeof businessData.logoUrl === "string" ? businessData.logoUrl : null,
      businessAddress:
        typeof businessData.businessAddress === "string"
          ? businessData.businessAddress
          : null,
      businessEmail:
        typeof businessData.businessEmail === "string"
          ? businessData.businessEmail
          : null,
      businessPhone:
        typeof businessData.businessPhone === "string"
          ? businessData.businessPhone
          : null,
      abn: typeof businessData.abn === "string" ? businessData.abn : null,
      registeredForGst,
      gstPercentage: registeredForGst ? gstPercentage : null,
      timezone:
        typeof businessData.timezone === "string" && businessData.timezone.trim()
          ? businessData.timezone.trim()
          : PLATFORM_TIME_ZONE,
    };
  } catch {
    return {
      businessName: null,
      bookingSlug: null,
      bookingPath: null,
      logoUrl: null,
      businessAddress: null,
      businessEmail: null,
      businessPhone: null,
      abn: null,
      registeredForGst: false,
      gstPercentage: null,
      timezone: PLATFORM_TIME_ZONE,
    };
  }
}

export async function createQuotationForInspection(
  businessId: string,
  createdBy: string,
  input: CreateQuotationInput,
  /**
   * Role of the author. Business owners/admins may quote any visit in their
   * business (e.g. when the assigned staff member cannot create quotations);
   * everyone else may only quote visits assigned to them.
   */
  authorRole?: string | null,
): Promise<
  | { ok: true; quotation: QuotationDetail }
  | { ok: false; status: number; error: string }
> {
  const inspectionId = input.inspectionRequestId.trim();
  if (!inspectionId) {
    return { ok: false, status: 400, error: "Missing request." };
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
    .collection("requests")
    .doc(inspectionId)
    .get();
  if (!requestSnap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const requestData = requestSnap.data() ?? {};
  if (requestData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  if (requestData.quotation && typeof requestData.quotation === "object") {
    return {
      ok: false,
      status: 400,
      error: "This visit already has a quotation.",
    };
  }

  const assigned = requestData.assignedTo as { uid?: string } | null;
  const isAssigned = assigned?.uid === createdBy;
  const isOwnerOrAdmin = authorRole === "owner" || authorRole === "admin";
  if (!isAssigned && !isOwnerOrAdmin) {
    return {
      ok: false,
      status: 403,
      error: "You can only create quotations for visits assigned to you.",
    };
  }

  const requestCustomer = (requestData.customer ?? {}) as {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  const requestAddress = (requestData.address ?? {}) as InspectionAddress;
  const customerSource = input.customer ?? requestCustomer;
  const addressSource = input.address ?? requestAddress;

  const customerParsed = parseStandaloneCustomer(customerSource);
  if (!customerParsed.ok) {
    return { ok: false, status: 400, error: customerParsed.error };
  }
  const addressParsed = parseStandaloneAddress(addressSource);
  if (!addressParsed.ok) {
    return { ok: false, status: 400, error: addressParsed.error };
  }

  const customer = customerParsed.value;
  const address = addressParsed.value;

  const subtotalAud = lineItems.reduce((sum, item) => sum + item.priceAud, 0);
  const discountAud =
    typeof input.discountAud === "number" &&
    Number.isFinite(input.discountAud) &&
    input.discountAud >= 0
      ? input.discountAud
      : 0;
  const computedFinal = Math.max(0, subtotalAud - discountAud);
  const finalPriceAud =
    typeof input.finalPriceAud === "number" &&
    Number.isFinite(input.finalPriceAud) &&
    input.finalPriceAud >= 0
      ? input.finalPriceAud
      : computedFinal;
  const imageUrls = parseImageUrls(input.imageUrls);
  const depositRequest = parseDepositRequest(input.depositRequest) ?? null;
  const balanceDueAud = computeBalanceDueAud(finalPriceAud);
  const baseTerms =
    typeof input.termsAndConditions === "string" &&
    input.termsAndConditions.trim()
      ? input.termsAndConditions.trim()
      : null;
  const termsAndConditions = depositRequest
    ? baseTerms
      ? `${baseTerms}\n\n${depositPaymentNote(depositRequest)}`
      : depositPaymentNote(depositRequest)
    : baseTerms;
  const serviceDescriptionInput = normalizeServiceDescription(
    input.serviceDescription,
  );

  const effectiveRequestType: InspectionRequestType =
    input.requestType === "existing_service" ||
    input.requestType === "custom_quote"
      ? input.requestType
      : requestData.requestType === "existing_service"
        ? "existing_service"
        : "custom_quote";

  const requestUpdate: Record<string, unknown> = {
    customer,
    address,
    updatedAt: FieldValue.serverTimestamp(),
  };

  let serviceTitle: string;
  let serviceDescription: string | null;

  if (effectiveRequestType === "custom_quote") {
    const cr = input.customRequest;
    const existingCustom =
      requestData.customRequest && typeof requestData.customRequest === "object"
        ? (requestData.customRequest as Record<string, unknown>)
        : null;

    const customTitle =
      cr && typeof cr.title === "string" && cr.title.trim()
        ? cr.title.trim()
        : typeof input.serviceTitle === "string" && input.serviceTitle.trim()
          ? input.serviceTitle.trim()
          : existingCustom && typeof existingCustom.title === "string"
            ? existingCustom.title.trim()
            : requestHeadline(requestData);

    const customDescription =
      cr && typeof cr.description === "string"
        ? cr.description.trim()
        : serviceDescriptionInput !== undefined && serviceDescriptionInput !== null
          ? serviceDescriptionInput
          : existingCustom && typeof existingCustom.description === "string"
            ? existingCustom.description.trim()
            : requestJobDescription(requestData) ?? "";

    if (customTitle.length < 3) {
      return {
        ok: false,
        status: 400,
        error: "Add a job title (at least 3 characters).",
      };
    }
    if (customDescription.length < 10) {
      return {
        ok: false,
        status: 400,
        error: "Describe the work needed (at least 10 characters).",
      };
    }

    serviceTitle = customTitle;
    serviceDescription = customDescription || null;
    requestUpdate.requestType = "custom_quote";
    requestUpdate.customRequest = {
      title: customTitle,
      description: customDescription,
    };
    requestUpdate.serviceName = null;
    requestUpdate.serviceId = null;
    requestUpdate.serviceDescription = serviceDescription;
  } else {
    const sid =
      typeof input.serviceId === "string" && input.serviceId.trim()
        ? input.serviceId.trim()
        : typeof requestData.serviceId === "string"
          ? requestData.serviceId.trim()
          : "";
    if (!sid) {
      return {
        ok: false,
        status: 400,
        error: "Select a service from the list.",
      };
    }
    const service = await lookupBusinessService(businessId, sid);
    if (!service) {
      return {
        ok: false,
        status: 400,
        error: "Selected service is no longer available.",
      };
    }
    serviceTitle = service.name;
    serviceDescription =
      serviceDescriptionInput !== undefined
        ? serviceDescriptionInput
        : requestJobDescription(requestData);
    requestUpdate.requestType = "existing_service";
    requestUpdate.serviceId = sid;
    requestUpdate.serviceName = service.name;
    requestUpdate.serviceBusinessType = service.businessType;
    requestUpdate.customRequest = null;
  }

  const ref = adminDb.collection(QUOTATION_COLLECTION).doc();
  const quotationCode = buildQuotationCodeForInspection({
    id: inspectionId,
    requestCode:
      typeof requestData.requestCode === "string"
        ? requestData.requestCode
        : null,
  });

  await requestSnap.ref.set(requestUpdate, { merge: true });

  await ref.set({
    quotationCode,
    businessId,
    inspectionRequestId: inspectionId,
    serviceTitle,
    serviceDescription,
    customer,
    address,
    lineItems: serializeLineItemsForFirestore(lineItems),
    subtotalAud,
    finalPriceAud,
    balanceDueAud,
    imageUrls,
    notes:
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.trim()
        : null,
    paymentInstructions: null,
    termsAndConditions,
    discountAud,
    depositRequest,
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
      businessAddress: businessBranding.businessAddress,
      businessEmail: businessBranding.businessEmail,
      businessPhone: businessBranding.businessPhone,
      bookingSlug: businessBranding.bookingSlug,
      bookingPath: businessBranding.bookingPath,
      abn: businessBranding.abn,
      registeredForGst: businessBranding.registeredForGst,
      gstPercentage: businessBranding.gstPercentage,
      timezone: businessBranding.timezone,
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

  const shouldSend = input.send === true;

  // Mirror quotation onto the linked request. The visit request stays
  // scheduled for drafts; sending moves it to awaiting_decision — never
  // auto-completes the request when the owner only opens the quote form.
  try {
    await requestSnap.ref.set(
      {
        quotation: {
          id: ref.id,
          quotationCode,
          finalPriceAud,
          subtotalAud,
          balanceDueAud,
          pdfUrl: quotation.pdfUrl ?? null,
          status: shouldSend ? "sent" : "draft",
          createdAt: FieldValue.serverTimestamp(),
        },
        ...(shouldSend
          ? {
              status: "awaiting_decision" satisfies InspectionRequestStatus,
              ...awaitingBookingFields(),
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (shouldSend) {
      await ref.set(
        {
          status: "sent",
          ...awaitingBookingFields(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      quotation = { ...quotation, status: "sent", bookingStatus: "awaiting" };
    }
  } catch (error) {
    console.error("quotation mirror to request failed:", error);
  }

  // Auto-save line items to the business item catalog for future reuse.
  try {
    const { catalogInputFromQuotationLineItem, upsertCatalogItems } =
      await import("@/lib/items/server");
    await upsertCatalogItems(
      businessId,
      createdBy,
      lineItems.map(catalogInputFromQuotationLineItem),
    );
  } catch {
    /* catalog auto-save is best-effort */
  }

  if (shouldSend) {
    await sendQuotationCreatedEmail(businessId, quotation, pdfBytes, businessBranding);
    try {
      const updatedSnap = await requestSnap.ref.get();
      const updatedRequest = mapInspectionDoc(
        inspectionId,
        updatedSnap.data() ?? {},
      );
      const { notifyCustomerOfQuotationSent } = await import(
        "@/lib/notifications/server"
      );
      await notifyCustomerOfQuotationSent(updatedRequest, {
        businessName: businessBranding.businessName,
        bookingSlug: businessBranding.bookingSlug,
        logoUrl: businessBranding.logoUrl,
        timezone: businessBranding.timezone,
      });
    } catch (error) {
      console.error("quotation sent notification failed:", error);
    }
  }

  await logQuotationAuditForActor(
    businessId,
    createdBy,
    {
      id: quotation.id,
      quotationCode: quotation.quotationCode,
      finalPriceAud: quotation.finalPriceAud,
      customer: quotation.customer,
    },
    {
      logCreated: true,
      logSent: shouldSend,
      origin: "from_inspection",
    },
  );

  return { ok: true, quotation };
}

export async function updateDraftQuotation(
  quotationId: string,
  businessId: string,
  updatedBy: string,
  input: CreateQuotationInput,
): Promise<
  | { ok: true; quotation: QuotationDetail }
  | { ok: false; status: number; error: string }
> {
  const id = quotationId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Missing quotation." };
  }

  const quotationRef = adminDb.collection(QUOTATION_COLLECTION).doc(id);
  const quotationSnap = await quotationRef.get();
  if (!quotationSnap.exists) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  const quotationData = quotationSnap.data() ?? {};
  if (quotationData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }
  if (quotationData.status === "sent") {
    return {
      ok: false,
      status: 400,
      error: "Sent quotations cannot be edited.",
    };
  }

  const inspectionId =
    typeof quotationData.inspectionRequestId === "string"
      ? quotationData.inspectionRequestId.trim()
      : input.inspectionRequestId.trim();
  if (!inspectionId) {
    return { ok: false, status: 400, error: "Missing request." };
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
    .collection("requests")
    .doc(inspectionId)
    .get();
  if (!requestSnap.exists) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const requestData = requestSnap.data() ?? {};
  if (requestData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const requestCustomer = (requestData.customer ?? {}) as {
    fullName?: string;
    email?: string;
    phone?: string;
  };
  const requestAddress = (requestData.address ?? {}) as InspectionAddress;
  const customerParsed = parseStandaloneCustomer(input.customer ?? requestCustomer);
  if (!customerParsed.ok) {
    return { ok: false, status: 400, error: customerParsed.error };
  }
  const addressParsed = parseStandaloneAddress(input.address ?? requestAddress);
  if (!addressParsed.ok) {
    return { ok: false, status: 400, error: addressParsed.error };
  }

  const customer = customerParsed.value;
  const address = addressParsed.value;
  const subtotalAud = lineItems.reduce((sum, item) => sum + item.priceAud, 0);
  const discountAud =
    typeof input.discountAud === "number" &&
    Number.isFinite(input.discountAud) &&
    input.discountAud >= 0
      ? input.discountAud
      : 0;
  const computedFinal = Math.max(0, subtotalAud - discountAud);
  const finalPriceAud =
    typeof input.finalPriceAud === "number" &&
    Number.isFinite(input.finalPriceAud) &&
    input.finalPriceAud >= 0
      ? input.finalPriceAud
      : computedFinal;
  const imageUrls = parseImageUrls(input.imageUrls);
  const depositRequest = parseDepositRequest(input.depositRequest) ?? null;
  const balanceDueAud = computeBalanceDueAud(finalPriceAud);
  const termsAndConditions =
    typeof input.termsAndConditions === "string" &&
    input.termsAndConditions.trim()
      ? input.termsAndConditions.trim()
      : null;
  const notes =
    typeof input.notes === "string" && input.notes.trim()
      ? input.notes.trim()
      : null;
  const validUntil =
    typeof input.validUntil === "string" && input.validUntil.trim()
      ? input.validUntil.trim()
      : null;
  const serviceDescriptionInput = normalizeServiceDescription(
    input.serviceDescription,
  );

  // Editing flows can (re)classify a draft as a custom quote. Persist that
  // tagging back to the request doc, otherwise the web app keeps reading the
  // stale `requestType`/`customRequest` and shows it as a service request.
  const effectiveRequestType: InspectionRequestType =
    input.requestType === "existing_service" ||
    input.requestType === "custom_quote"
      ? input.requestType
      : requestData.requestType === "existing_service"
        ? "existing_service"
        : "custom_quote";

  const requestUpdate: Record<string, unknown> = {
    customer,
    address,
    updatedAt: FieldValue.serverTimestamp(),
  };

  let serviceTitle: string;
  let serviceDescription: string | null;

  if (effectiveRequestType === "custom_quote") {
    const cr = input.customRequest;
    const existingCustom =
      requestData.customRequest && typeof requestData.customRequest === "object"
        ? (requestData.customRequest as Record<string, unknown>)
        : null;

    const customTitle =
      cr && typeof cr.title === "string" && cr.title.trim()
        ? cr.title.trim()
        : typeof input.serviceTitle === "string" && input.serviceTitle.trim()
          ? input.serviceTitle.trim()
          : typeof quotationData.serviceTitle === "string" &&
              quotationData.serviceTitle.trim()
            ? quotationData.serviceTitle.trim()
            : existingCustom && typeof existingCustom.title === "string"
              ? existingCustom.title.trim()
              : requestHeadline(requestData);

    const customDescription =
      cr && typeof cr.description === "string"
        ? cr.description.trim()
        : serviceDescriptionInput !== undefined && serviceDescriptionInput !== null
          ? serviceDescriptionInput
          : typeof quotationData.serviceDescription === "string"
            ? quotationData.serviceDescription.trim()
            : existingCustom && typeof existingCustom.description === "string"
              ? existingCustom.description.trim()
              : "";

    serviceTitle = customTitle;
    serviceDescription = customDescription || null;

    requestUpdate.requestType = "custom_quote";
    requestUpdate.customRequest = {
      title: customTitle,
      description: customDescription,
    };
    requestUpdate.serviceName = null;
    requestUpdate.serviceId = null;
    requestUpdate.serviceDescription = serviceDescription;
  } else {
    const sid =
      typeof input.serviceId === "string" && input.serviceId.trim()
        ? input.serviceId.trim()
        : typeof requestData.serviceId === "string"
          ? requestData.serviceId.trim()
          : "";
    if (sid) {
      const service = await lookupBusinessService(businessId, sid);
      if (service) {
        serviceTitle = service.name;
        requestUpdate.requestType = "existing_service";
        requestUpdate.serviceId = sid;
        requestUpdate.serviceName = service.name;
        requestUpdate.serviceBusinessType = service.businessType;
        requestUpdate.customRequest = null;
      } else {
        serviceTitle =
          typeof quotationData.serviceTitle === "string" &&
          quotationData.serviceTitle.trim()
            ? quotationData.serviceTitle.trim()
            : requestHeadline(requestData);
      }
    } else {
      serviceTitle =
        typeof quotationData.serviceTitle === "string" &&
        quotationData.serviceTitle.trim()
          ? quotationData.serviceTitle.trim()
          : requestHeadline(requestData);
    }
    serviceDescription =
      serviceDescriptionInput !== undefined
        ? serviceDescriptionInput
        : typeof quotationData.serviceDescription === "string" &&
            quotationData.serviceDescription.trim()
          ? quotationData.serviceDescription.trim()
          : requestJobDescription(requestData);
  }

  await requestSnap.ref.set(requestUpdate, { merge: true });

  await quotationRef.set(
    {
      serviceTitle,
      serviceDescription,
      customer,
      address,
      lineItems: serializeLineItemsForFirestore(lineItems),
      subtotalAud,
      finalPriceAud,
      balanceDueAud,
      imageUrls,
      notes,
      paymentInstructions: null,
      termsAndConditions,
      discountAud,
      depositRequest,
      validUntil,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let saved = await quotationRef.get();
  let quotation = mapQuotationDoc(quotationRef.id, saved.data() ?? {});
  const businessBranding = await loadQuotationBusinessBranding(businessId);

  let pdfBytes: Buffer | null = null;
  try {
    const { generateQuotationPdf } = await import("@/lib/quotations/pdf");
    const { uploadQuotationPdf } = await import(
      "@/lib/onboarding/services/upload"
    );
    pdfBytes = await generateQuotationPdf(quotation, {
      businessName: businessBranding.businessName,
      logoUrl: businessBranding.logoUrl,
      businessAddress: businessBranding.businessAddress,
      businessEmail: businessBranding.businessEmail,
      businessPhone: businessBranding.businessPhone,
      bookingSlug: businessBranding.bookingSlug,
      bookingPath: businessBranding.bookingPath,
      abn: businessBranding.abn,
      registeredForGst: businessBranding.registeredForGst,
      gstPercentage: businessBranding.gstPercentage,
      timezone: businessBranding.timezone,
      inspectionRequestCode:
        typeof requestData.requestCode === "string"
          ? requestData.requestCode
          : null,
    });
    const uploaded = await uploadQuotationPdf(pdfBytes, {
      businessId,
      inspectionRequestId: inspectionId,
      quotationId: quotationRef.id,
    });
    if (uploaded.ok) {
      await quotationRef.set(
        { pdfUrl: uploaded.url, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      quotation = { ...quotation, pdfUrl: uploaded.url };
    }
  } catch (error) {
    console.error("draft quotation PDF regeneration failed:", error);
  }

  const shouldSend = input.send === true;
  const quotationCode =
    typeof quotationData.quotationCode === "string" &&
    quotationData.quotationCode.trim()
      ? quotationData.quotationCode.trim()
      : buildQuotationCodeForInspection({
          id: inspectionId,
          requestCode:
            typeof requestData.requestCode === "string"
              ? requestData.requestCode
              : null,
        });

  try {
    await requestSnap.ref.set(
      {
        quotation: {
          id: quotationRef.id,
          quotationCode,
          finalPriceAud,
          subtotalAud,
          balanceDueAud,
          pdfUrl: quotation.pdfUrl ?? null,
          status: shouldSend ? "sent" : "draft",
          createdAt:
            quotationData.createdAt ?? requestData.quotation?.createdAt ?? null,
        },
        ...(shouldSend
          ? {
              status: "awaiting_decision" satisfies InspectionRequestStatus,
              ...awaitingBookingFields(),
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (shouldSend) {
      await quotationRef.set(
        {
          status: "sent",
          ...awaitingBookingFields(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      quotation = { ...quotation, status: "sent", bookingStatus: "awaiting" };
    }
  } catch (error) {
    console.error("draft quotation mirror to request failed:", error);
  }

  try {
    const { catalogInputFromQuotationLineItem, upsertCatalogItems } =
      await import("@/lib/items/server");
    await upsertCatalogItems(
      businessId,
      updatedBy,
      lineItems.map(catalogInputFromQuotationLineItem),
    );
  } catch {
    /* catalog auto-save is best-effort */
  }

  if (shouldSend) {
    await sendQuotationCreatedEmail(businessId, quotation, pdfBytes, businessBranding);
    try {
      const updatedSnap = await requestSnap.ref.get();
      const updatedRequest = mapInspectionDoc(
        inspectionId,
        updatedSnap.data() ?? {},
      );
      const { notifyCustomerOfQuotationSent } = await import(
        "@/lib/notifications/server"
      );
      await notifyCustomerOfQuotationSent(updatedRequest, {
        businessName: businessBranding.businessName,
        bookingSlug: businessBranding.bookingSlug,
        logoUrl: businessBranding.logoUrl,
        timezone: businessBranding.timezone,
      });
    } catch (error) {
      console.error("draft quotation sent notification failed:", error);
    }
  }

  saved = await quotationRef.get();
  quotation = mapQuotationDoc(quotationRef.id, saved.data() ?? {});

  if (shouldSend) {
    await logQuotationAuditForActor(
      businessId,
      updatedBy,
      {
        id: quotation.id,
        quotationCode: quotation.quotationCode,
        finalPriceAud: quotation.finalPriceAud,
        customer: quotation.customer,
      },
      {
        logCreated: false,
        logSent: true,
        origin: "from_inspection",
      },
    );
  }

  return { ok: true, quotation };
}

export async function cancelQuotation(
  quotationId: string,
  businessId: string,
): Promise<
  | { ok: true; quotation: QuotationDetail }
  | { ok: false; status: number; error: string }
> {
  const id = quotationId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Missing quotation." };
  }

  const quotationRef = adminDb.collection(QUOTATION_COLLECTION).doc(id);
  const quotationSnap = await quotationRef.get();
  if (!quotationSnap.exists) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  const quotationData = quotationSnap.data() ?? {};
  if (quotationData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }
  if (quotationData.status === "cancelled") {
    return { ok: true, quotation: mapQuotationDoc(quotationSnap.id, quotationData) };
  }
  if (typeof quotationData.invoiceId === "string" && quotationData.invoiceId) {
    return {
      ok: false,
      status: 400,
      error: "Quotations with invoices cannot be cancelled.",
    };
  }
  const invoiceSnap = await adminDb.collection("invoices").doc(id).get();
  if (invoiceSnap.exists && invoiceSnap.data()?.businessId === businessId) {
    return {
      ok: false,
      status: 400,
      error: "Quotations with invoices cannot be cancelled.",
    };
  }

  const inspectionRequestId =
    typeof quotationData.inspectionRequestId === "string"
      ? quotationData.inspectionRequestId.trim()
      : "";
  const now = FieldValue.serverTimestamp();
  let cancelledFromRequestStatus: string | null = null;
  let cancelledFromRequestBookingStatus: string | null = null;
  let cancelledFromRequestBookingStatusAt: unknown = null;

  if (inspectionRequestId) {
    const requestSnap = await adminDb
      .collection("requests")
      .doc(inspectionRequestId)
      .get();
    const requestData = requestSnap.data() ?? {};
    cancelledFromRequestStatus =
      typeof requestData.status === "string" ? requestData.status : null;
    cancelledFromRequestBookingStatus =
      typeof requestData.bookingStatus === "string"
        ? requestData.bookingStatus
        : null;
    cancelledFromRequestBookingStatusAt = requestData.bookingStatusAt ?? null;
  }

  await quotationRef.set(
    {
      status: "cancelled",
      cancelledFromStatus:
        quotationData.status === "sent" || quotationData.status === "draft"
          ? quotationData.status
          : "draft",
      cancelledFromCustomerDecision:
        quotationData.customerDecision === "accepted" ||
        quotationData.customerDecision === "rejected"
          ? quotationData.customerDecision
          : null,
      cancelledFromCustomerDecisionAt: quotationData.customerDecisionAt ?? null,
      cancelledFromBookingStatus:
        typeof quotationData.bookingStatus === "string"
          ? quotationData.bookingStatus
          : null,
      cancelledFromBookingStatusAt: quotationData.bookingStatusAt ?? null,
      cancelledFromRequestStatus,
      cancelledFromRequestBookingStatus,
      cancelledFromRequestBookingStatusAt,
      customerDecision: null,
      customerDecisionAt: null,
      bookingStatus: null,
      bookingStatusAt: null,
      updatedAt: now,
    },
    { merge: true },
  );

  if (inspectionRequestId) {
    const requestRef = adminDb.collection("requests").doc(inspectionRequestId);
    const requestSnap = await requestRef.get();
    if (requestSnap.exists) {
      const requestData = requestSnap.data() ?? {};
      const summary = requestData.quotation as
        | { id?: string; createdAt?: unknown }
        | null
        | undefined;
      if (
        requestData.businessId === businessId &&
        summary?.id === quotationRef.id
      ) {
        await requestRef.set(
          {
            quotation: {
              ...summary,
              id: quotationRef.id,
              quotationCode:
                typeof quotationData.quotationCode === "string"
                  ? quotationData.quotationCode
                  : null,
              finalPriceAud:
                typeof quotationData.finalPriceAud === "number"
                  ? quotationData.finalPriceAud
                  : 0,
              subtotalAud:
                typeof quotationData.subtotalAud === "number"
                  ? quotationData.subtotalAud
                  : 0,
              balanceDueAud:
                typeof quotationData.balanceDueAud === "number"
                  ? quotationData.balanceDueAud
                  : 0,
              pdfUrl:
                typeof quotationData.pdfUrl === "string"
                  ? quotationData.pdfUrl
                  : null,
              status: "cancelled",
            },
            ...(requestData.status === "awaiting_decision"
              ? {
                  status: "completed" satisfies InspectionRequestStatus,
                  bookingStatus: null,
                  bookingStatusAt: null,
                }
              : {}),
            updatedAt: now,
          },
          { merge: true },
        );
      }
    }
  }

  const saved = await quotationRef.get();
  return { ok: true, quotation: mapQuotationDoc(saved.id, saved.data() ?? {}) };
}

export async function undoCancelQuotation(
  quotationId: string,
  businessId: string,
): Promise<
  | { ok: true; quotation: QuotationDetail }
  | { ok: false; status: number; error: string }
> {
  const id = quotationId.trim();
  if (!id) {
    return { ok: false, status: 400, error: "Missing quotation." };
  }

  const quotationRef = adminDb.collection(QUOTATION_COLLECTION).doc(id);
  const quotationSnap = await quotationRef.get();
  if (!quotationSnap.exists) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  const quotationData = quotationSnap.data() ?? {};
  if (quotationData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }
  if (quotationData.status !== "cancelled") {
    return {
      ok: false,
      status: 400,
      error: "Only cancelled quotations can be restored.",
    };
  }

  const restoredStatus =
    quotationData.cancelledFromStatus === "sent" ? "sent" : "draft";
  const now = FieldValue.serverTimestamp();
  const restoredCustomerDecision =
    quotationData.cancelledFromCustomerDecision === "accepted" ||
    quotationData.cancelledFromCustomerDecision === "rejected"
      ? quotationData.cancelledFromCustomerDecision
      : null;
  const restoredCustomerDecisionAt =
    restoredCustomerDecision && quotationData.cancelledFromCustomerDecisionAt
      ? quotationData.cancelledFromCustomerDecisionAt
      : null;

  await quotationRef.set(
    {
      status: restoredStatus,
      customerDecision:
        restoredStatus === "sent" ? restoredCustomerDecision : null,
      customerDecisionAt:
        restoredStatus === "sent" ? restoredCustomerDecisionAt : null,
      ...(restoredStatus === "sent"
        ? {
            bookingStatus:
              quotationData.cancelledFromBookingStatus === "awaiting"
                ? "awaiting"
                : "awaiting",
            bookingStatusAt:
              quotationData.cancelledFromBookingStatusAt ??
              FieldValue.serverTimestamp(),
          }
        : {
            bookingStatus: null,
            bookingStatusAt: null,
          }),
      updatedAt: now,
    },
    { merge: true },
  );

  const inspectionRequestId =
    typeof quotationData.inspectionRequestId === "string"
      ? quotationData.inspectionRequestId.trim()
      : "";
  if (inspectionRequestId) {
    const requestRef = adminDb.collection("requests").doc(inspectionRequestId);
    const requestSnap = await requestRef.get();
    if (requestSnap.exists) {
      const requestData = requestSnap.data() ?? {};
      const summary = requestData.quotation as
        | { id?: string; createdAt?: unknown }
        | null
        | undefined;
      if (
        requestData.businessId === businessId &&
        summary?.id === quotationRef.id
      ) {
        await requestRef.set(
          {
            quotation: {
              ...summary,
              id: quotationRef.id,
              quotationCode:
                typeof quotationData.quotationCode === "string"
                  ? quotationData.quotationCode
                  : null,
              finalPriceAud:
                typeof quotationData.finalPriceAud === "number"
                  ? quotationData.finalPriceAud
                  : 0,
              subtotalAud:
                typeof quotationData.subtotalAud === "number"
                  ? quotationData.subtotalAud
                  : 0,
              balanceDueAud:
                typeof quotationData.balanceDueAud === "number"
                  ? quotationData.balanceDueAud
                  : 0,
              pdfUrl:
                typeof quotationData.pdfUrl === "string"
                  ? quotationData.pdfUrl
                  : null,
              status: restoredStatus,
              customerDecision:
                restoredStatus === "sent" ? restoredCustomerDecision : null,
              customerDecisionAt:
                restoredStatus === "sent" ? restoredCustomerDecisionAt : null,
            },
            ...(restoredStatus === "sent"
              ? {
                  status: "awaiting_decision" satisfies InspectionRequestStatus,
                  ...awaitingBookingFields(),
                }
              : {
                  status:
                    typeof quotationData.cancelledFromRequestStatus ===
                      "string" &&
                    (REQUEST_STATUSES as readonly string[]).includes(
                      quotationData.cancelledFromRequestStatus,
                    )
                      ? quotationData.cancelledFromRequestStatus
                      : requestData.status,
                  bookingStatus:
                    quotationData.cancelledFromRequestBookingStatus ?? null,
                  bookingStatusAt:
                    quotationData.cancelledFromRequestBookingStatusAt ?? null,
                }),
            updatedAt: now,
          },
          { merge: true },
        );
      }
    }
  }

  const saved = await quotationRef.get();
  return { ok: true, quotation: mapQuotationDoc(saved.id, saved.data() ?? {}) };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type StandaloneQuotationInput = {
  customer: { fullName: string; email: string; phone: string };
  address: InspectionAddress;
  title?: string;
  description?: string | null;
  requestType?: InspectionRequestType;
  serviceId?: string | null;
  customRequest?: { title: string; description: string } | null;
  lineItems: QuotationLineItem[];
  finalPriceAud?: number | null;
  notes?: string | null;
  paymentInstructions?: string | null;
  termsAndConditions?: string | null;
  discountAud?: number | null;
  validUntil?: string | null;
  imageUrls?: string[];
  depositRequest?: unknown;
  /** When true, emails/SMS the customer and marks the quotation as sent. */
  send?: boolean;
  /** How the backing request is tagged. Defaults to `quotation_direct`. */
  createdSource?: "quotation_direct" | "invoice_direct";
};

type ServiceLookup = { name: string; businessType: string };

async function lookupBusinessService(
  businessId: string,
  serviceId: string,
): Promise<ServiceLookup | null> {
  const snap = await adminDb
    .collection(COLLECTIONS.SERVICES)
    .doc(serviceId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || data.businessId !== businessId) return null;

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const businessType =
    typeof data.businessType === "string"
      ? data.businessType
      : typeof data.category === "string"
        ? data.category
        : "";
  return name ? { name, businessType } : null;
}

function parseStandaloneRequestType(
  raw: unknown,
): InspectionRequestType {
  return raw === "existing_service" ? "existing_service" : "custom_quote";
}

type QuotationCustomerInput = {
  fullName?: string;
  email?: string;
  phone?: string;
} | null | undefined;

function parseStandaloneCustomer(
  raw: QuotationCustomerInput,
): { ok: true; value: InspectionCustomer } | { ok: false; error: string } {
  const fullName = (raw?.fullName ?? "").trim();
  const email = (raw?.email ?? "").trim().toLowerCase();
  const phone = (raw?.phone ?? "").replace(/\D/g, "");
  if (fullName.length < 2) {
    return { ok: false, error: "Customer name is required." };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: "Enter a valid customer email address." };
  }
  if (phone.length < 6) {
    return { ok: false, error: "Enter a valid customer mobile number." };
  }
  return { ok: true, value: { fullName, email, phone } };
}

type QuotationAddressInput = {
  street?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
} | null | undefined;

function parseStandaloneAddress(
  raw: QuotationAddressInput,
): { ok: true; value: InspectionAddress } | { ok: false; error: string } {
  const address: InspectionAddress = {
    street: (raw?.street ?? "").trim(),
    suburb: (raw?.suburb ?? "").trim(),
    state: (raw?.state ?? "").trim(),
    postcode: (raw?.postcode ?? "").trim(),
  };
  if (
    address.street.length < 3 ||
    address.suburb.length < 2 ||
    address.state.length < 2 ||
    address.postcode.length < 3
  ) {
    return { ok: false, error: "Enter a complete service address." };
  }
  return { ok: true, value: address };
}

async function resolveOwnerAssignment(
  uid: string,
): Promise<InspectionAssignment> {
  let name = "Business owner";
  let email: string | null = null;
  try {
    const snap = await adminDb.collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() ?? {} : {};
    if (typeof data.fullName === "string" && data.fullName.trim()) {
      name = data.fullName.trim();
    }
    if (typeof data.email === "string" && data.email.trim()) {
      email = data.email.trim();
    }
  } catch {
    /* fall back to defaults */
  }
  return { type: "owner", uid, name, email };
}

/**
 * Creates a quotation directly (without an existing request). This
 * also creates a matching `requests` document that is already
 * marked complete, tagged with the `quotation_direct` source, so the quote
 * shows up in both the Quotations and Requests boards.
 */
export async function createStandaloneQuotation(
  businessId: string,
  createdBy: string,
  input: StandaloneQuotationInput,
): Promise<
  | { ok: true; quotation: QuotationDetail }
  | { ok: false; status: number; error: string }
> {
  const customerParsed = parseStandaloneCustomer(input.customer);
  if (!customerParsed.ok) {
    return { ok: false, status: 400, error: customerParsed.error };
  }

  const addressParsed = parseStandaloneAddress(input.address);
  if (!addressParsed.ok) {
    return { ok: false, status: 400, error: addressParsed.error };
  }

  const requestType = parseStandaloneRequestType(input.requestType);

  let serviceId: string | null = null;
  let serviceName: string | null = null;
  let serviceBusinessType: string | null = null;
  let customRequest: { title: string; description: string } | null = null;
  let serviceDescription: string | null = null;
  let quotationTitle = (input.title ?? "").trim();

  if (requestType === "existing_service") {
    const sid =
      typeof input.serviceId === "string" ? input.serviceId.trim() : "";
    if (!sid) {
      return {
        ok: false,
        status: 400,
        error: "Select a service from the list.",
      };
    }
    const service = await lookupBusinessService(businessId, sid);
    if (!service) {
      return {
        ok: false,
        status: 400,
        error: "Selected service is no longer available.",
      };
    }
    serviceId = sid;
    serviceName = service.name;
    serviceBusinessType = service.businessType;
    quotationTitle = service.name;
  } else {
    const cr = input.customRequest;
    const customTitle =
      typeof cr?.title === "string" && cr.title.trim()
        ? cr.title.trim()
        : quotationTitle;
    const customDescription =
      typeof cr?.description === "string" && cr.description.trim()
        ? cr.description.trim()
        : typeof input.description === "string"
          ? input.description.trim()
          : "";
    if (customTitle.length < 3) {
      return {
        ok: false,
        status: 400,
        error: "Add a job title (at least 3 characters).",
      };
    }
    if (customDescription.length < 10) {
      return {
        ok: false,
        status: 400,
        error: "Describe the work needed (at least 10 characters).",
      };
    }
    customRequest = { title: customTitle, description: customDescription };
    serviceDescription = customDescription;
    quotationTitle = customTitle;
  }

  if (quotationTitle.length < 3) {
    return {
      ok: false,
      status: 400,
      error: "Add a title for this quotation.",
    };
  }

  const lineItems = parseLineItems(input.lineItems);
  if (!lineItems || lineItems.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Add at least one line item with a name and price.",
    };
  }

  const customer = customerParsed.value;
  const address = addressParsed.value;

  const subtotalAud = lineItems.reduce((sum, item) => sum + item.priceAud, 0);
  const discountAud =
    typeof input.discountAud === "number" &&
    Number.isFinite(input.discountAud) &&
    input.discountAud >= 0
      ? input.discountAud
      : 0;
  const computedFinal = Math.max(0, subtotalAud - discountAud);
  const finalPriceAud =
    typeof input.finalPriceAud === "number" &&
    Number.isFinite(input.finalPriceAud) &&
    input.finalPriceAud >= 0
      ? input.finalPriceAud
      : computedFinal;
  const imageUrls = parseImageUrls(input.imageUrls);

  const depositRequest = parseDepositRequest(input.depositRequest) ?? null;
  const balanceDueAud = computeBalanceDueAud(finalPriceAud);
  const baseTerms =
    typeof input.termsAndConditions === "string" &&
    input.termsAndConditions.trim()
      ? input.termsAndConditions.trim()
      : null;
  const termsAndConditions = depositRequest
    ? baseTerms
      ? `${baseTerms}\n\n${depositPaymentNote(depositRequest)}`
      : depositPaymentNote(depositRequest)
    : baseTerms;

  const businessBranding = await loadQuotationBusinessBranding(businessId);

  // Auto-create (or reuse) a customer portal account, then email welcome + quotation.
  let customerId: string | null = null;
  try {
    const account = await ensureCustomerAccount({
      email: customer.email,
      fullName: customer.fullName,
      phone: customer.phone,
      businessId,
      businessName: businessBranding.businessName,
      bookingSlug: businessBranding.bookingSlug,
      logoUrl: businessBranding.logoUrl,
      context: "quotation",
    });
    customerId = account.uid;
  } catch (error) {
    console.error("[quotation] customer account creation failed:", error);
  }

  const now = FieldValue.serverTimestamp();
  const ownerAssignment = await resolveOwnerAssignment(createdBy);

  // 1. Create the completed request record (source: quotation_direct).
  const inspectionRef = adminDb.collection(REQUESTS_COLLECTION).doc();
  const requestCode = await allocateInspectionRequestCode();
  await inspectionRef.set({
    id: inspectionRef.id,
    businessId,
    requestCode,
    status: "completed",
    requestType,
    serviceId,
    serviceName,
    serviceBusinessType,
    customRequest,
    customer,
    customerId,
    createdSource: input.createdSource ?? "quotation_direct",
    address,
    preferredSlots: [],
    jobPreferredSlots: [],
    adminJobPreferredSlots: [],
    jobProposedSlots: [],
    ownerProposedSlots: [],
    scheduledSlot: null,
    scheduledStartTime: null,
    scheduledEndTime: null,
    assignedTo: ownerAssignment,
    ownerNote: null,
    customerNotes:
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.trim()
        : null,
    budgetAud: finalPriceAud,
    createdAt: now,
    updatedAt: now,
    visitStartedAt: now,
    visitEndedAt: now,
  });

  // 2. Create the quotation document linked to that request.
  const ref = adminDb.collection(QUOTATION_COLLECTION).doc();
  const quotationCode = buildQuotationCodeForInspection({
    id: inspectionRef.id,
    requestCode,
  });

  await ref.set({
    quotationCode,
    businessId,
    inspectionRequestId: inspectionRef.id,
    serviceTitle: quotationTitle,
    serviceDescription,
    customer,
    address,
    lineItems: serializeLineItemsForFirestore(lineItems),
    subtotalAud,
    finalPriceAud,
    balanceDueAud,
    imageUrls,
    notes:
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.trim()
        : null,
    paymentInstructions: null,
    termsAndConditions,
    discountAud,
    depositRequest,
    validUntil:
      typeof input.validUntil === "string" && input.validUntil.trim()
        ? input.validUntil.trim()
        : null,
    status: "draft",
    createdBy,
    createdAt: now,
    updatedAt: now,
  });

  const saved = await ref.get();
  let quotation = mapQuotationDoc(ref.id, saved.data() ?? {});

  // 3. Generate a branded PDF, upload it, and persist its URL.
  let pdfBytes: Buffer | null = null;
  try {
    const { generateQuotationPdf } = await import("@/lib/quotations/pdf");
    const { uploadQuotationPdf } = await import(
      "@/lib/onboarding/services/upload"
    );
    pdfBytes = await generateQuotationPdf(quotation, {
      businessName: businessBranding.businessName,
      logoUrl: businessBranding.logoUrl,
      businessAddress: businessBranding.businessAddress,
      businessEmail: businessBranding.businessEmail,
      businessPhone: businessBranding.businessPhone,
      bookingSlug: businessBranding.bookingSlug,
      bookingPath: businessBranding.bookingPath,
      abn: businessBranding.abn,
      registeredForGst: businessBranding.registeredForGst,
      gstPercentage: businessBranding.gstPercentage,
      timezone: businessBranding.timezone,
      inspectionRequestCode: requestCode,
    });
    const uploaded = await uploadQuotationPdf(pdfBytes, {
      businessId,
      inspectionRequestId: inspectionRef.id,
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
    console.error("standalone quotation PDF generation failed:", error);
  }

  const shouldSend = input.send === true;

  // 4. Mirror the quotation summary onto the request.
  try {
    await inspectionRef.set(
      {
        quotation: {
          id: ref.id,
          quotationCode,
          finalPriceAud,
          subtotalAud,
          balanceDueAud,
          pdfUrl: quotation.pdfUrl ?? null,
          status: shouldSend ? "sent" : "draft",
          createdAt: FieldValue.serverTimestamp(),
        },
        ...(shouldSend
          ? {
              status: "awaiting_decision" satisfies InspectionRequestStatus,
              ...awaitingBookingFields(),
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (shouldSend) {
      await ref.set(
        {
          status: "sent",
          ...awaitingBookingFields(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      quotation = { ...quotation, status: "sent", bookingStatus: "awaiting" };
    }
  } catch (error) {
    console.error("standalone quotation mirror to inspection failed:", error);
  }

  // 5. Auto-save line items to the catalog for future reuse.
  try {
    const { catalogInputFromQuotationLineItem, upsertCatalogItems } =
      await import("@/lib/items/server");
    await upsertCatalogItems(
      businessId,
      createdBy,
      lineItems.map(catalogInputFromQuotationLineItem),
    );
  } catch {
    /* catalog auto-save is best-effort */
  }

  // 6. Email the customer their quotation PDF and surface it in the portal when explicitly sending.
  if (shouldSend) {
    try {
      await sendQuotationCreatedEmail(businessId, quotation, pdfBytes, businessBranding);
    } catch (error) {
      console.error("standalone quotation email failed:", error);
    }
    try {
      const updatedSnap = await inspectionRef.get();
      const updatedRequest = mapInspectionDoc(
        inspectionRef.id,
        updatedSnap.data() ?? {},
      );
      const { notifyCustomerOfQuotationSent } = await import(
        "@/lib/notifications/server"
      );
      await notifyCustomerOfQuotationSent(updatedRequest, {
        businessName: businessBranding.businessName,
        bookingSlug: businessBranding.bookingSlug,
        logoUrl: businessBranding.logoUrl,
        timezone: businessBranding.timezone,
      });
    } catch (error) {
      console.error("standalone quotation sent notification failed:", error);
    }
  }

  await logQuotationAuditForActor(
    businessId,
    createdBy,
    {
      id: quotation.id,
      quotationCode: quotation.quotationCode,
      finalPriceAud: quotation.finalPriceAud,
      customer: quotation.customer,
    },
    {
      logCreated: true,
      logSent: shouldSend,
      origin: "standalone",
    },
  );

  return { ok: true, quotation };
}

/** Lists quotations for an request (admin viewing). */
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
    adminDb.collection("requests").doc(id).get(),
  ]);

  const inspectionData = inspectionSnap.data() ?? {};
  const inspectionCreatedSource = parseCreatedSource(
    inspectionData.createdSource,
  );
  const fallbackBookingId =
    typeof inspectionData.bookingId === "string" ? inspectionData.bookingId : null;
  const fallbackBookingCode =
    typeof inspectionData.bookingCode === "string"
      ? inspectionData.bookingCode
      : null;
  const mirroredQuotationStatus =
    inspectionData.quotation &&
    typeof inspectionData.quotation === "object" &&
    typeof (inspectionData.quotation as { status?: unknown }).status ===
      "string"
      ? (inspectionData.quotation as { status: string }).status
      : null;
  const fallbackBookingStatus =
    parseBookingStatus(inspectionData.bookingStatus) ??
    (fallbackBookingId
      ? ("scheduled" as const)
      : mirroredQuotationStatus === "sent"
        ? ("awaiting" as const)
        : !mirroredQuotationStatus &&
            inspectionData.status === "awaiting_decision"
          ? ("awaiting" as const)
          : null);
  const fallbackBookingStatusAt = toMillis(inspectionData.bookingStatusAt);
  const fallbackServiceDescription = requestJobDescription(inspectionData);

  return snap.docs
    .map((doc) => {
      const quotation = mapQuotationDoc(doc.id, doc.data() ?? {});
      const needsBookingId = !quotation.bookingId && fallbackBookingId;
      const needsBookingStatus =
        fallbackBookingStatus &&
        (!quotation.bookingStatus || !quotation.bookingStatusAt);
      const withSource = inspectionCreatedSource
        ? { ...quotation, createdSource: inspectionCreatedSource }
        : { ...quotation };
      if (!withSource.serviceDescription && fallbackServiceDescription) {
        withSource.serviceDescription = fallbackServiceDescription;
      }
      if (!needsBookingId && !needsBookingStatus) return withSource;
      return {
        ...withSource,
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

export const QUOTATION_LIST_LIMIT = 80;

async function enrichQuotationsFromInspections(
  quotations: QuotationDetail[],
): Promise<QuotationDetail[]> {
  const ids = [
    ...new Set(
      quotations
        .map((q) => q.inspectionRequestId.trim())
        .filter((id) => id.length > 0),
    ),
  ];
  if (ids.length === 0) return quotations;

  type InspectionMeta = {
    createdSource: InspectionRequestCreatedSource | null;
    status: QuotationDetail["inspectionRequestStatus"];
    bookingId: string | null;
    bookingCode: string | null;
    bookingStatus: ReturnType<typeof parseBookingStatus>;
    bookingStatusAt: number | null;
    serviceDescription: string | null;
  };

  const metaById = new Map<string, InspectionMeta>();
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const refs = chunk.map((id) =>
      adminDb.collection(REQUESTS_COLLECTION).doc(id),
    );
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() ?? {};
      const bookingId =
        typeof data.bookingId === "string" ? data.bookingId : null;
      const bookingCode =
        typeof data.bookingCode === "string" ? data.bookingCode : null;
      const mirroredQuotationStatus =
        data.quotation &&
        typeof data.quotation === "object" &&
        typeof (data.quotation as { status?: unknown }).status === "string"
          ? (data.quotation as { status: string }).status
          : null;
      const bookingStatus =
        parseBookingStatus(data.bookingStatus) ??
        (bookingId
          ? ("scheduled" as const)
          : mirroredQuotationStatus === "sent"
            ? ("awaiting" as const)
            : !mirroredQuotationStatus && data.status === "awaiting_decision"
              ? ("awaiting" as const)
              : null);
      const status =
        typeof data.status === "string" &&
        (REQUEST_STATUSES as readonly string[]).includes(data.status)
          ? (data.status as InspectionRequestStatus)
          : null;
      metaById.set(snap.id, {
        createdSource: parseCreatedSource(data.createdSource),
        status,
        bookingId,
        bookingCode,
        bookingStatus,
        bookingStatusAt: toMillis(data.bookingStatusAt),
        serviceDescription: requestJobDescription(data),
      });
    }
  }

  return quotations.map((quotation) => {
    const meta = metaById.get(quotation.inspectionRequestId.trim());
    if (!meta) return quotation;

    const needsBookingId = !quotation.bookingId && meta.bookingId;
    const needsBookingStatus =
      meta.bookingStatus &&
      (!quotation.bookingStatus || !quotation.bookingStatusAt);

    return {
      ...quotation,
      ...(meta.createdSource ? { createdSource: meta.createdSource } : {}),
      ...(meta.status ? { inspectionRequestStatus: meta.status } : {}),
      ...(!quotation.serviceDescription && meta.serviceDescription
        ? { serviceDescription: meta.serviceDescription }
        : {}),
      ...(needsBookingId
        ? {
            bookingId: meta.bookingId,
            bookingCode: quotation.bookingCode ?? meta.bookingCode,
          }
        : {}),
      ...(needsBookingStatus
        ? {
            bookingStatus: quotation.bookingStatus ?? meta.bookingStatus,
            bookingStatusAt:
              quotation.bookingStatusAt ?? meta.bookingStatusAt,
          }
        : {}),
    };
  });
}

/** Loads one quotation for a business, with inspection metadata when linked. */
export async function getBusinessQuotationById(
  businessId: string,
  quotationId: string,
): Promise<QuotationDetail | null> {
  const snap = await adminDb
    .collection(QUOTATION_COLLECTION)
    .doc(quotationId)
    .get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  if (data.businessId !== businessId) return null;
  const [quotation] = await enrichQuotationsFromInspections([
    mapQuotationDoc(snap.id, data),
  ]);
  if (!quotation) return null;
  const { enrichQuotationsWithInvoices } = await import(
    "@/lib/invoices/enrich-quotations"
  );
  const [enriched] = await enrichQuotationsWithInvoices([quotation]);
  return enriched ?? null;
}

/** Lists all quotations for a business (newest first). */
export async function listBusinessQuotations(
  businessId: string,
): Promise<QuotationDetail[]> {
  const snapshot = await adminDb
    .collection(QUOTATION_COLLECTION)
    .where("businessId", "==", businessId)
    .orderBy("createdAt", "desc")
    .limit(QUOTATION_LIST_LIMIT)
    .get();

  const quotations = snapshot.docs.map((doc) =>
    mapQuotationDoc(doc.id, doc.data() ?? {}),
  );
  const enriched = await enrichQuotationsFromInspections(quotations);
  const { enrichQuotationsWithInvoices } = await import(
    "@/lib/invoices/enrich-quotations"
  );
  return enrichQuotationsWithInvoices(enriched);
}

/** Lists quotations created by a specific staff member (newest first). */
export async function listStaffQuotations(
  businessId: string,
  createdBy: string,
): Promise<QuotationDetail[]> {
  const snapshot = await adminDb
    .collection(QUOTATION_COLLECTION)
    .where("businessId", "==", businessId)
    .where("createdBy", "==", createdBy)
    .orderBy("createdAt", "desc")
    .limit(QUOTATION_LIST_LIMIT)
    .get();

  const quotations = snapshot.docs.map((doc) =>
    mapQuotationDoc(doc.id, doc.data() ?? {}),
  );
  const enriched = await enrichQuotationsFromInspections(quotations);
  const { enrichQuotationsWithInvoices } = await import(
    "@/lib/invoices/enrich-quotations"
  );
  return enrichQuotationsWithInvoices(enriched);
}

/** Staff-scoped list with indexed query, falling back to in-memory filter. */
export async function listQuotationsForMember(
  businessId: string,
  memberUid: string,
): Promise<QuotationDetail[]> {
  const uid = memberUid.trim();
  if (!uid) return [];

  try {
    const staffList = await listStaffQuotations(businessId, uid);
    return staffList.filter((quotation) => quotation.createdBy === uid);
  } catch (error) {
    console.error(
      "listStaffQuotations failed, filtering business list in memory:",
      error,
    );
    const all = await listBusinessQuotations(businessId);
    return all.filter((quotation) => quotation.createdBy === uid);
  }
}

async function applyQuotationCustomerDecision(
  requestSnap: FirebaseFirestore.DocumentSnapshot,
  quotationId: string,
  decision: "accepted" | "rejected",
  options: {
    notifyBusiness?: boolean;
    jobPreferredSlots?: InspectionSlot[];
  } = {},
): Promise<
  | { ok: true; request: ReturnType<typeof mapInspectionDoc> }
  | { ok: false; status: number; error: string }
> {
  const data = requestSnap.data() ?? {};
  let request = mapInspectionDoc(requestSnap.id, data);
  const summary = request.quotation;

  if (!summary || summary.id !== quotationId) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  // Legacy mirrors may lack `status`; they were always sent on creation.
  if (summary.status === "draft") {
    return {
      ok: false,
      status: 400,
      error: "There is no sent quotation awaiting a decision.",
    };
  }
  if (request.bookingId) {
    return {
      ok: false,
      status: 400,
      error: "This quotation has already been converted into a job.",
    };
  }
  if (summary.customerDecision === decision) {
    return { ok: true, request };
  }

  const decidedAt = FieldValue.serverTimestamp();
  const jobSlots =
    decision === "accepted" && options.jobPreferredSlots?.length
      ? options.jobPreferredSlots
      : null;

  await adminDb
    .collection(QUOTATION_COLLECTION)
    .doc(quotationId)
    .set(
      {
        customerDecision: decision,
        customerDecisionAt: decidedAt,
        updatedAt: decidedAt,
      },
      { merge: true },
    );
  await requestSnap.ref.set(
    {
      quotation: {
        ...(typeof data.quotation === "object" && data.quotation
          ? data.quotation
          : {}),
        customerDecision: decision,
        customerDecisionAt: decidedAt,
      },
      ...(jobSlots ? { jobPreferredSlots: jobSlots } : {}),
      updatedAt: decidedAt,
    },
    { merge: true },
  );

  const updatedRequest = {
    ...request,
    ...(jobSlots ? { jobPreferredSlots: jobSlots } : {}),
    quotation: summary
      ? {
          ...summary,
          customerDecision: decision,
          customerDecisionAt: Date.now(),
        }
      : null,
  };
  request = updatedRequest;

  if (options.notifyBusiness) {
    try {
      const { notifyBusinessOfQuotationDecision } = await import(
        "@/lib/notifications/server"
      );
      const businessSnap = await adminDb
        .collection("businesses")
        .doc(request.businessId)
        .get();
      const businessData = businessSnap.data() ?? {};
      await notifyBusinessOfQuotationDecision(updatedRequest, decision, {
        businessName:
          typeof businessData.businessName === "string"
            ? businessData.businessName
            : null,
        bookingSlug:
          typeof businessData.bookingSlug === "string"
            ? businessData.bookingSlug
            : null,
      });
    } catch (error) {
      console.error("quotation decision notification failed:", error);
    }
  }

  return { ok: true, request: updatedRequest };
}

/**
 * Records the customer's accept/reject decision on a sent quotation. The
 * business cannot schedule a job or issue an invoice until it is accepted.
 */
export async function customerDecideQuotation(
  requestId: string,
  identity: CustomerOwnershipIdentity,
  decision: "accepted" | "rejected",
  jobPreferredSlots?: InspectionSlot[],
): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  const { getRequestDocument } = await import(
    "@/lib/inspection/request-document"
  );
  const snap = await getRequestDocument(requestId);
  if (!snap) {
    return { ok: false, status: 404, error: "Request not found." };
  }
  const data = snap.data() ?? {};
  const request = mapInspectionDoc(snap.id, data);

  if (!customerOwnsRequestRecord(request, identity)) {
    return { ok: false, status: 404, error: "Request not found." };
  }

  const summary = request.quotation;
  if (!summary) {
    return {
      ok: false,
      status: 400,
      error: "There is no quotation awaiting your decision.",
    };
  }

  const result = await applyQuotationCustomerDecision(
    snap,
    summary.id,
    decision,
    {
      notifyBusiness: true,
      ...(decision === "accepted" && jobPreferredSlots?.length
        ? { jobPreferredSlots }
        : {}),
    },
  );
  if (!result.ok) return result;
  return { ok: true };
}

/**
 * Lets the business owner record the customer's accept/reject decision when
 * the customer confirms verbally or outside the booking engine.
 */
export async function businessRecordQuotationCustomerDecision(
  quotationId: string,
  businessId: string,
  decision: "accepted" | "rejected",
): Promise<
  | { ok: true; request: ReturnType<typeof mapInspectionDoc> }
  | { ok: false; status: number; error: string }
> {
  const quotationSnap = await adminDb
    .collection(QUOTATION_COLLECTION)
    .doc(quotationId.trim())
    .get();
  if (!quotationSnap.exists) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }
  const quotationData = quotationSnap.data() ?? {};
  if (quotationData.businessId !== businessId) {
    return { ok: false, status: 404, error: "Quotation not found." };
  }

  const inspectionRequestId =
    typeof quotationData.inspectionRequestId === "string"
      ? quotationData.inspectionRequestId.trim()
      : "";
  if (!inspectionRequestId) {
    return {
      ok: false,
      status: 400,
      error: "This quotation is not linked to a visit.",
    };
  }

  const { getRequestDocument } = await import(
    "@/lib/inspection/request-document"
  );
  const requestSnap = await getRequestDocument(inspectionRequestId);
  if (!requestSnap) {
    return { ok: false, status: 404, error: "Linked request not found." };
  }

  return applyQuotationCustomerDecision(
    requestSnap,
    quotationSnap.id,
    decision,
    { notifyBusiness: false },
  );
}

async function sendQuotationCreatedEmail(
  businessId: string,
  quotation: QuotationDetail,
  pdfBytes: Buffer | null,
  businessBranding: QuotationBusinessBranding,
): Promise<void> {
  if (!pdfBytes?.length) return;

  const customer = quotation.customer;
  const email = customer.email?.trim();
  if (!email) return;

  const { sendQuotationSentEmail } = await import(
    "@/lib/email/templates/quotation-sent"
  );

  const { businessName, bookingSlug, logoUrl } = businessBranding;
  const quoteCode = displayQuotationCode(quotation);

  await sendQuotationSentEmail({
    customerEmail: email,
    customerPhone: customer.phone ?? null,
    customerFullName: customer.fullName,
    quoteNo: quoteCode,
    serviceTitle: quotation.serviceTitle,
    validUntil: quotation.validUntil,
    totalAud: quotation.finalPriceAud,
    depositRequest: quotation.depositRequest,
    balanceDueAud: quotation.balanceDueAud,
    businessName,
    bookingSlug,
    logoUrl,
    businessId,
    pdfBytes,
    pdfFileName: `${quoteCode || "quotation"}.pdf`.replace(/[^a-z0-9.\-]+/gi, "-"),
  });
}
