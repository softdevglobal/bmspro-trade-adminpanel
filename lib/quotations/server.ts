import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { parseBookingStatus } from "@/lib/bookings/types";
import type {
  CreateQuotationInput,
  QuotationDepositRequest,
  QuotationDetail,
  QuotationLineItem,
} from "@/lib/quotations/types";
export type {
  CreateQuotationInput,
  QuotationDepositRequest,
  QuotationDetail,
  QuotationLineItem,
} from "@/lib/quotations/types";
import { mapInspectionDoc } from "@/lib/inspection/map-inspection-doc";
import { notifyCustomerOfStatusChange } from "@/lib/notifications/server";
import {
  INSPECTION_COLLECTION,
  type InspectionAddress,
  type InspectionAssignment,
  type InspectionCustomer,
  type InspectionRequestCreatedSource,
  type InspectionRequestStatus,
  type InspectionRequestType,
  REQUEST_STATUSES,
  parseCreatedSource,
} from "@/lib/inspection/types";
import { ensureCustomerAccount } from "@/lib/customer/server";
import { COLLECTIONS } from "@/lib/onboarding/services/collections";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  buildQuotationCodeForInspection,
  displayQuotationCode,
} from "@/lib/reference-codes";
import { allocateInspectionRequestCode } from "@/lib/reference-codes.server";
import { FieldValue } from "firebase-admin/firestore";

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
  depositRequest: QuotationDepositRequest | null,
): number {
  if (!depositRequest || depositRequest.amountAud <= 0) {
    return Math.max(0, Math.round(finalPriceAud * 100) / 100);
  }
  const depositPaid = Math.min(depositRequest.amountAud, finalPriceAud);
  return Math.max(0, Math.round((finalPriceAud - depositPaid) * 100) / 100);
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
      : computeBalanceDueAud(finalPriceAud, depositRequest);

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
      if (data.status === "sent") {
        return "awaiting";
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
    gstPercent: typeof item.gstPercent === "number" ? item.gstPercent : null,
  };
}

function serializeLineItemsForFirestore(items: QuotationLineItem[]) {
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
    };
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
  const balanceDueAud = computeBalanceDueAud(finalPriceAud, depositRequest);
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
  const ref = adminDb.collection(QUOTATION_COLLECTION).doc();
  const quotationCode = buildQuotationCodeForInspection({
    id: inspectionId,
    requestCode:
      typeof requestData.requestCode === "string"
        ? requestData.requestCode
        : null,
  });

  await requestSnap.ref.set(
    {
      customer,
      address,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await ref.set({
    quotationCode,
    businessId,
    inspectionRequestId: inspectionId,
    serviceTitle: requestHeadline(requestData),
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
          balanceDueAud,
          pdfUrl: quotation.pdfUrl ?? null,
          status: "sent",
          createdAt: FieldValue.serverTimestamp(),
        },
        ...awaitingBookingFields(),
        ...(shouldComplete ? { status: "completed" as const } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await ref.set(
      {
        status: "sent",
        ...awaitingBookingFields(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    quotation = { ...quotation, status: "sent", bookingStatus: "awaiting" };

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

  await sendQuotationCreatedEmail(quotation, pdfBytes, businessBranding);

  return { ok: true, quotation };
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
 * Creates a quotation directly (without an existing inspection visit). This
 * also creates a matching `inspection_requests` document that is already
 * marked complete, tagged with the `quotation_direct` source, so the quote
 * shows up in both the Quotations and Inspection visits boards.
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
  const description =
    requestType === "custom_quote" && customRequest
      ? customRequest.description
      : typeof input.description === "string" && input.description.trim()
        ? input.description.trim()
        : "";

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
  const balanceDueAud = computeBalanceDueAud(finalPriceAud, depositRequest);
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

  // 1. Create the completed inspection visit record (source: quotation_direct).
  const inspectionRef = adminDb.collection(INSPECTION_COLLECTION).doc();
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
    createdSource: "quotation_direct",
    address,
    preferredSlots: [],
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

  // 2. Create the quotation document linked to that inspection visit.
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

  // 4. Mirror the quotation summary onto the inspection visit and mark sent.
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
          status: "sent",
          createdAt: FieldValue.serverTimestamp(),
        },
        ...awaitingBookingFields(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await ref.set(
      {
        status: "sent",
        ...awaitingBookingFields(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    quotation = { ...quotation, status: "sent", bookingStatus: "awaiting" };
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

  // 6. Email the customer their quotation PDF.
  try {
    await sendQuotationCreatedEmail(quotation, pdfBytes, businessBranding);
  } catch (error) {
    console.error("standalone quotation email failed:", error);
  }

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
  const inspectionCreatedSource = parseCreatedSource(
    inspectionData.createdSource,
  );
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
      : inspectionData.quotation
        ? ("awaiting" as const)
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
      const withSource = inspectionCreatedSource
        ? { ...quotation, createdSource: inspectionCreatedSource }
        : quotation;
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
  };

  const metaById = new Map<string, InspectionMeta>();
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const refs = chunk.map((id) =>
      adminDb.collection(INSPECTION_COLLECTION).doc(id),
    );
    const snaps = await adminDb.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const data = snap.data() ?? {};
      const bookingId =
        typeof data.bookingId === "string" ? data.bookingId : null;
      const bookingCode =
        typeof data.bookingCode === "string" ? data.bookingCode : null;
      const bookingStatus =
        parseBookingStatus(data.bookingStatus) ??
        (bookingId
          ? ("scheduled" as const)
          : data.quotation
            ? ("awaiting" as const)
            : data.status === "awaiting_decision"
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
  return quotation ?? null;
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
  return enrichQuotationsFromInspections(quotations);
}

async function sendQuotationCreatedEmail(
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
    pdfBytes,
    pdfFileName: `${quoteCode || "quotation"}.pdf`.replace(/[^a-z0-9.\-]+/gi, "-"),
  });
}
