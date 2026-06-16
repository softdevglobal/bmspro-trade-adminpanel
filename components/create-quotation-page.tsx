"use client";

import { AuPhoneInput } from "@/components/au-phone-input";
import { QuotationDocumentPreview } from "@/components/quotation-document-preview";
import {
  DiscountEditModal,
  type DocumentDiscount,
} from "@/components/discount-edit-modal";
import {
  DepositRequestModal,
  type DepositRequest,
} from "@/components/deposit-request-modal";
import { MonthCalendarField } from "@/components/month-calendar-field";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import {
  computeDocumentTotals,
  computeQuotationLineAmounts,
  formatQuoteDate,
  attachmentDisplayName,
  isPdfAttachmentUrl,
  buildQuotationDocumentDeposit,
  type GstPricingMode,
  type QuotationDocumentData,
} from "@/lib/quotations/document";
import {
  formatAddress,
  STATUS_LABELS,
  type InspectionAddress,
  type InspectionRequestDetail,
  type InspectionRequestType,
} from "@/lib/inspection/types";
import type { BusinessServiceDetail } from "@/lib/onboarding/services/display";
import type { QuotationDetail } from "@/lib/quotations/types";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import { platformTodayIso } from "@/lib/platform/timezone";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

type Tab = "create" | "preview" | "send";

type CatalogItem = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  priceAud: number;
};

type CustomerOption = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  address: InspectionAddress | null;
  lastActivity: number;
};

type SavedLineItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  quantity: number;
  rate: number;
  discountPercent: number;
  applyGst: boolean;
  amountAud: number;
};

type DraftLineItem = {
  code: string;
  name: string;
  description: string;
  quantity: string;
  rate: string;
  discountPercent: string;
  applyGst: boolean;
  showOptions: boolean;
};

type TermsId = "same_day" | "net_7" | "net_14" | "net_30";

function formatTermsLabel(days: number): string {
  if (days === 0) return "Same day";
  if (days === 1) return "1 day";
  return `${days} days`;
}

const TERMS_OPTIONS: { id: TermsId; days: number }[] = [
  { id: "same_day", days: 0 },
  { id: "net_7", days: 7 },
  { id: "net_14", days: 14 },
  { id: "net_30", days: 30 },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10";

const NUMBER_INPUT_CLASS = `${INPUT_CLASS} [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

const EMPTY_ADDRESS: InspectionAddress = {
  street: "",
  suburb: "",
  state: "",
  postcode: "",
};

function todayIso(timeZone?: string | null): string {
  return platformTodayIso(new Date(), timeZone);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetweenIso(startIso: string, endIso: string): number | null {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  if (![sy, sm, sd, ey, em, ed].every(Number.isFinite)) return null;
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.round((end - start) / 86_400_000);
}

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

function SaveSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-2">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
      />
      {label}
    </span>
  );
}

function parseNum(value: string): number {
  const n = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** @deprecated Use computeQuotationLineAmounts — kept for gross-before-discount checks. */
function lineAmount(
  quantity: number,
  rate: number,
  discountPercent: number,
): number {
  const base = quantity * rate * (1 - discountPercent / 100);
  return Math.round(base * 100) / 100;
}

function lineGstPercent(
  applyGst: boolean,
  gstEnabled: boolean,
  gstPercentage: number,
): number {
  return applyGst && gstEnabled ? gstPercentage : 0;
}

function computeSavedLineAmount(
  item: Pick<SavedLineItem, "quantity" | "rate" | "discountPercent" | "applyGst">,
  gstEnabled: boolean,
  gstPercentage: number,
  gstPricing: GstPricingMode,
): number {
  return computeQuotationLineAmounts({
    quantity: item.quantity,
    rate: item.rate,
    discountPercent: item.discountPercent,
    gstPercent: lineGstPercent(item.applyGst, gstEnabled, gstPercentage),
    gstPricing,
  }).amountAud;
}

function customerKey(request: InspectionRequestDetail): string {
  const email = request.customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = request.customer.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${request.customer.fullName.trim().toLowerCase()}`;
}

function buildCustomerOptions(
  requests: InspectionRequestDetail[],
): CustomerOption[] {
  const map = new Map<string, CustomerOption>();
  for (const request of requests) {
    const key = customerKey(request);
    const activity = request.updatedAt ?? request.createdAt ?? 0;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        id: key,
        fullName: request.customer.fullName?.trim() || "Unknown",
        email: request.customer.email?.trim() || "",
        phone: request.customer.phone?.trim() || "",
        address: request.address,
        lastActivity: activity,
      });
      continue;
    }
    if (activity > existing.lastActivity) {
      existing.lastActivity = activity;
      existing.address = request.address;
    }
    if (!existing.fullName && request.customer.fullName) {
      existing.fullName = request.customer.fullName.trim();
    }
    if (!existing.email && request.customer.email) {
      existing.email = request.customer.email.trim();
    }
    if (!existing.phone && request.customer.phone) {
      existing.phone = request.customer.phone.trim();
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );
}

function requestServiceTitle(request: InspectionRequestDetail): string {
  if (request.requestType === "existing_service") {
    return request.serviceName ?? "Existing service";
  }
  return request.customRequest?.title ?? "Custom quotation request";
}

function formatCustomerContact(
  phone: string | null | undefined,
  email: string | null | undefined,
): string {
  return [formatAuPhoneDisplay(phone), email?.trim() ?? ""]
    .filter(Boolean)
    .join(" · ");
}

function requestHasActiveQuotation(request: InspectionRequestDetail): boolean {
  if (!request.quotation) return false;
  return request.quotation.status !== "cancelled";
}

function requestMatchesQuery(
  request: InspectionRequestDetail,
  query: string,
): boolean {
  if (!query) return true;
  const haystack = [
    request.requestCode,
    request.id,
    request.customer.fullName,
    request.customer.email,
    request.customer.phone,
    requestServiceTitle(request),
    formatAddress(request.address),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function savedLineItemFromQuotation(
  item: QuotationDetail["lineItems"][number],
  index: number,
): SavedLineItem {
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const rate =
    item.rateAud && item.rateAud > 0
      ? item.rateAud
      : Math.round((item.priceAud / quantity) * 100) / 100;
  const gstPercent = item.gstPercent ?? 0;
  return {
    id: `${index}-${item.name}-${crypto.randomUUID()}`,
    code: item.code ?? "",
    name: item.name,
    description: item.description ?? "",
    quantity,
    rate,
    discountPercent: 0,
    applyGst: gstPercent > 0,
    amountAud: item.priceAud,
  };
}

function SectionLink({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-4 py-3.5 text-left font-body text-[15px] font-semibold text-primary transition-colors hover:border-primary/30 hover:bg-primary/5"
    >
      <span className="material-symbols-outlined text-[22px]">{icon}</span>
      {label}
    </button>
  );
}

function RequestTypeCard({
  icon,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon: string;
  label: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      disabled={disabled}
      className={`flex w-full min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-primary bg-surface-container-lowest shadow-sm ring-1 ring-primary/20"
          : "border-outline-variant/60 bg-surface-container-lowest hover:border-primary/40"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          selected
            ? "bg-primary text-on-primary"
            : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-body text-[14px] font-semibold text-on-surface">
          {label}
        </span>
        <span className="mt-0.5 block font-body text-[12px] text-on-surface-variant">
          {description}
        </span>
      </span>
      {selected ? (
        <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[20px] text-primary">
          check_circle
        </span>
      ) : null}
    </button>
  );
}

export function CreateQuotationPage() {
  const router = useRouter();
  const { user } = useAuth();
  const business = useBusinessProfile();
  const { requests } = useInspectionRequests();
  const timeZone = business?.timezone;

  const [tab, setTab] = useState<Tab>("create");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientOpen, setClientOpen] = useState(false);
  const [serviceEditing, setServiceEditing] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [requestPickerOpen, setRequestPickerOpen] = useState(false);
  const [requestSearch, setRequestSearch] = useState("");
  const [customer, setCustomer] = useState({
    fullName: "",
    email: "",
    phone: "",
  });
  const [address, setAddress] = useState<InspectionAddress>({
    ...EMPTY_ADDRESS,
  });

  const [requestType, setRequestType] =
    useState<InspectionRequestType>("custom_quote");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [customServiceTitle, setCustomServiceTitle] = useState("");
  const [customServiceDescription, setCustomServiceDescription] = useState("");
  const [services, setServices] = useState<BusinessServiceDetail[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogSuggestField, setCatalogSuggestField] = useState<
    "code" | "name" | null
  >(null);
  const [lineItems, setLineItems] = useState<SavedLineItem[]>([]);
  const [itemDraft, setItemDraft] = useState<DraftLineItem | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [termsLoaded, setTermsLoaded] = useState(false);
  const [comment, setComment] = useState("");

  const [quotationDate, setQuotationDate] = useState(todayIso(timeZone));
  const [terms, setTerms] = useState<TermsId>("same_day");
  const [documentDiscount, setDocumentDiscount] =
    useState<DocumentDiscount | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstPercentage, setGstPercentage] = useState(10);
  const [gstPricing, setGstPricing] = useState<GstPricingMode>("exclusive");
  const [depositRequest, setDepositRequest] = useState<DepositRequest | null>(
    null,
  );
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [businessAddress, setBusinessAddress] = useState<string | null>(null);
  const [businessEmail, setBusinessEmail] = useState<string | null>(null);
  const [businessPhone, setBusinessPhone] = useState<string | null>(null);
  const [businessAbn, setBusinessAbn] = useState<string | null>(null);

  // When opened from an request (e.g. a visit run by staff who can't
  // create quotations), bind the quotation to that existing visit and prefill
  // the customer/service instead of creating a brand-new standalone visit.
  const [inspectionRequestId, setInspectionRequestId] = useState<string | null>(
    null,
  );
  const [draftQuotationId, setDraftQuotationId] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const frames: number[] = [];
    const quotationId =
      params.get("quotationId")?.trim() || params.get("draftId")?.trim();
    if (quotationId) {
      frames.push(requestAnimationFrame(() => setDraftQuotationId(quotationId)));
    }
    if (
      params.get("fromRequests") === "1" ||
      params.get("selectRequest") === "1"
    ) {
      frames.push(requestAnimationFrame(() => setRequestPickerOpen(true)));
    }
    const id =
      params.get("requestId")?.trim() ||
      params.get("inspectionRequestId")?.trim();
    if (id) {
      frames.push(requestAnimationFrame(() => setInspectionRequestId(id)));
    }
    return () => {
      frames.forEach((frame) => cancelAnimationFrame(frame));
    };
  }, []);

  const boundInspection = useMemo(
    () =>
      inspectionRequestId
        ? (requests.find((r) => r.id === inspectionRequestId) ?? null)
        : null,
    [inspectionRequestId, requests],
  );

  const inspectionPrefilledRef = useRef(false);
  const draftPrefilledRef = useRef(false);

  const availableRequests = useMemo(
    () =>
      requests
        .filter((request) => {
          if (request.status === "cancelled") return false;
          if (request.bookingId) return false;
          if (requestHasActiveQuotation(request)) return false;
          return true;
        })
        .sort(
          (a, b) =>
            (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
        ),
    [requests],
  );

  const filteredRequests = useMemo(() => {
    const query = requestSearch.trim().toLowerCase();
    return availableRequests
      .filter((request) => requestMatchesQuery(request, query))
      .slice(0, 12);
  }, [availableRequests, requestSearch]);

  const applyInspectionRequest = useCallback((request: InspectionRequestDetail) => {
    inspectionPrefilledRef.current = true;
    setInspectionRequestId(request.id);
    setCustomer({
      fullName: request.customer.fullName ?? "",
      email: request.customer.email ?? "",
      phone: request.customer.phone ?? "",
    });
    setAddress({ ...EMPTY_ADDRESS, ...request.address });
    setCustomerSearch(request.customer.fullName ?? "");
    setClientOpen(false);
    setServiceEditing(false);
    if (request.requestType === "existing_service" && request.serviceId) {
      setRequestType("existing_service");
      setSelectedServiceId(request.serviceId);
      setCustomServiceTitle("");
      setCustomServiceDescription("");
    } else {
      setRequestType("custom_quote");
      setSelectedServiceId(null);
      setCustomServiceTitle(
        request.customRequest?.title ?? request.serviceName ?? "",
      );
      setCustomServiceDescription(request.customRequest?.description ?? "");
    }
    setRequestPickerOpen(false);
    setRequestSearch("");
    setError(null);
  }, []);

  useEffect(() => {
    if (inspectionPrefilledRef.current || !boundInspection) return;
    const frame = requestAnimationFrame(() => {
      applyInspectionRequest(boundInspection);
    });
    return () => cancelAnimationFrame(frame);
  }, [applyInspectionRequest, boundInspection]);

  useEffect(() => {
    if (!user || !draftQuotationId || draftPrefilledRef.current) return;
    draftPrefilledRef.current = true;
    void (async () => {
      setDraftLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/quotations?quotationId=${encodeURIComponent(draftQuotationId)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          quotation?: QuotationDetail;
        };
        if (!response.ok || !data.ok || !data.quotation) {
          throw new Error(data.error ?? "Could not load draft quotation.");
        }
        const quotation = data.quotation;
        if (quotation.status !== "draft") {
          throw new Error("Only draft quotations can be edited.");
        }

        inspectionPrefilledRef.current = true;
        setInspectionRequestId(quotation.inspectionRequestId);
        setCustomer({
          fullName: quotation.customer.fullName ?? "",
          email: quotation.customer.email ?? "",
          phone: quotation.customer.phone ?? "",
        });
        setAddress({ ...EMPTY_ADDRESS, ...quotation.address });
        setClientOpen(false);
        setServiceEditing(false);
        setCustomServiceTitle(quotation.serviceTitle ?? "");
        setCustomServiceDescription(quotation.serviceDescription ?? "");
        setLineItems(
          quotation.lineItems.map((item, index) =>
            savedLineItemFromQuotation(item, index),
          ),
        );
        setImageUrls(quotation.imageUrls);
        setTermsAndConditions(quotation.termsAndConditions ?? "");
        setTermsLoaded(true);
        setComment(quotation.notes ?? "");
        setDocumentDiscount(
          quotation.discountAud > 0
            ? {
                mode: "fixed",
                percent: 0,
                amountAud: quotation.discountAud,
              }
            : null,
        );
        setDepositRequest(quotation.depositRequest);

        if (quotation.lineItems.some((item) => (item.gstPercent ?? 0) > 0)) {
          setGstEnabled(true);
          const gstPercent = quotation.lineItems.find(
            (item) => (item.gstPercent ?? 0) > 0,
          )?.gstPercent;
          if (gstPercent) setGstPercentage(gstPercent);
        }

        if (quotation.validUntil) {
          const today = todayIso(timeZone);
          const days = daysBetweenIso(today, quotation.validUntil);
          const matchingTerms = TERMS_OPTIONS.find(
            (option) => option.days === days,
          );
          if (matchingTerms) {
            setQuotationDate(today);
            setTerms(matchingTerms.id);
          } else {
            setQuotationDate(quotation.validUntil);
            setTerms("same_day");
          }
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load draft quotation.",
        );
      } finally {
        setDraftLoading(false);
      }
    })();
  }, [user, draftQuotationId, timeZone]);

  const customerOptions = useMemo(
    () => buildCustomerOptions(requests),
    [requests],
  );

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customerOptions.slice(0, 8);
    return customerOptions
      .filter(
        (c) =>
          c.fullName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.phone.includes(q),
      )
      .slice(0, 8);
  }, [customerOptions, customerSearch]);

  const activeServices = useMemo(
    () => services.filter((service) => service.isActive),
    [services],
  );

  const selectedService = useMemo(
    () =>
      activeServices.find((service) => service.id === selectedServiceId) ??
      null,
    [activeServices, selectedServiceId],
  );

  const previewServiceTitle = useMemo(() => {
    if (boundInspection) {
      return requestServiceTitle(boundInspection);
    }
    if (requestType === "existing_service") {
      return selectedService?.name ?? null;
    }
    const title = customServiceTitle.trim();
    return title.length >= 3 ? title : null;
  }, [boundInspection, requestType, selectedService, customServiceTitle]);

  const previewServiceDescription = useMemo(() => {
    if (boundInspection?.requestType === "custom_quote") {
      return (
        customServiceDescription.trim() ||
        boundInspection.customRequest?.description?.trim() ||
        null
      );
    }
    if (requestType !== "custom_quote") return null;
    return customServiceDescription.trim() || null;
  }, [boundInspection, requestType, customServiceDescription]);

  const catalogSuggestions = useMemo(() => {
    if (!itemDraft || !catalogSuggestField || catalog.length === 0) return [];
    const query =
      catalogSuggestField === "code"
        ? (itemDraft.code ?? "").trim().toLowerCase()
        : (itemDraft.name ?? "").trim().toLowerCase();
    const matches = query
      ? catalog.filter((item) => {
          const name = item.name.toLowerCase();
          const code = (item.code ?? "").toLowerCase();
          const description = (item.description ?? "").toLowerCase();
          return (
            name.includes(query) ||
            code.includes(query) ||
            description.includes(query)
          );
        })
      : catalog;
    return matches.slice(0, 8);
  }, [catalog, itemDraft, catalogSuggestField]);

  const dueDate = useMemo(() => {
    const opt = TERMS_OPTIONS.find((t) => t.id === terms);
    return addDaysIso(quotationDate, opt?.days ?? 0);
  }, [quotationDate, terms]);

  const minQuotationDate = useMemo(
    () => addDaysIso(todayIso(timeZone), -730),
    [timeZone],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setLineItems((prev) =>
        prev.map((item) => ({
          ...item,
          amountAud: computeSavedLineAmount(
            item,
            gstEnabled,
            gstPercentage,
            gstPricing,
          ),
        })),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [gstEnabled, gstPercentage, gstPricing]);

  const documentLineItems = useMemo(
    () =>
      lineItems.map((item) => {
        const gstPercent = lineGstPercent(
          item.applyGst,
          gstEnabled,
          gstPercentage,
        );
        const { amountAud, rateAudExGst } = computeQuotationLineAmounts({
          quantity: item.quantity,
          rate: item.rate,
          discountPercent: item.discountPercent,
          gstPercent,
          gstPricing,
        });
        return {
          code: (item.code ?? "").trim() || null,
          name: item.name,
          description: item.description || null,
          quantity: item.quantity,
          rateAud: rateAudExGst,
          gstPercent,
          amountAud,
        };
      }),
    [lineItems, gstEnabled, gstPercentage, gstPricing],
  );

  const subtotal = useMemo(
    () =>
      documentLineItems.reduce((sum, item) => sum + item.amountAud, 0),
    [documentLineItems],
  );

  const discountAmount = useMemo(() => {
    if (!documentDiscount) return 0;
    if (documentDiscount.mode === "percent") {
      const pct = Math.min(100, Math.max(0, documentDiscount.percent));
      return Math.round(((subtotal * pct) / 100) * 100) / 100;
    }
    return Math.min(documentDiscount.amountAud, subtotal);
  }, [documentDiscount, subtotal]);

  const documentTotals = useMemo(
    () =>
      computeDocumentTotals({
        lineItems: documentLineItems,
        discountAud: discountAmount,
      }),
    [documentLineItems, discountAmount],
  );

  const gstAmount = documentTotals.gstAud;
  const total = documentTotals.totalAud;
  const depositPaidAud = depositRequest?.amountAud ?? 0;
  const balanceDueAud = Math.max(
    0,
    Math.round((total - depositPaidAud) * 100) / 100,
  );

  useEffect(() => {
    if (!depositRequest || total <= 0) return;
    const capped = Math.min(depositRequest.amountAud, total);
    if (Math.abs(capped - depositRequest.amountAud) > 0.001) {
      const frame = requestAnimationFrame(() => {
        setDepositRequest((prev) =>
          prev ? { ...prev, amountAud: capped } : prev,
        );
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [total, depositRequest]);

  useEffect(() => {
    if (!documentDiscount || documentDiscount.mode !== "fixed") return;
    const capped = Math.min(documentDiscount.amountAud, subtotal);
    if (Math.abs(capped - documentDiscount.amountAud) > 0.001) {
      const frame = requestAnimationFrame(() => {
        setDocumentDiscount((prev) =>
          prev ? { ...prev, amountAud: capped } : prev,
        );
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [subtotal, documentDiscount]);

  async function refreshCatalog(token: string) {
    try {
      const itemsRes = await fetch("/api/items", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const itemsData = (await itemsRes.json()) as {
        ok?: boolean;
        items?: CatalogItem[];
      };
      if (itemsRes.ok && itemsData.ok && itemsData.items) {
        setCatalog(
          itemsData.items.map((item) => ({
            ...item,
            code: item.code ?? null,
            description: item.description ?? null,
          })),
        );
      }
    } catch {
      /* optional */
    }
  }

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const [itemsRes, profileRes, servicesRes] = await Promise.all([
          fetch("/api/items", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/business/profile", {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch("/api/services", {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const itemsData = (await itemsRes.json()) as {
          ok?: boolean;
          items?: CatalogItem[];
        };
        if (itemsRes.ok && itemsData.ok && itemsData.items) {
          setCatalog(
            itemsData.items.map((item) => ({
              ...item,
              code: item.code ?? null,
              description: item.description ?? null,
            })),
          );
        }
        const profileData = (await profileRes.json()) as {
          ok?: boolean;
          profile?: {
            registeredForGst?: boolean;
            gstPercentage?: number | null;
            businessAddress?: string | null;
            businessEmail?: string | null;
            businessPhone?: string | null;
            abn?: string | null;
            termsAndConditions?: string | null;
          };
        };
        if (profileRes.ok && profileData.ok && profileData.profile) {
          const profile = profileData.profile;
          setGstEnabled(Boolean(profile.registeredForGst));
          if (profile.gstPercentage != null) {
            setGstPercentage(profile.gstPercentage);
          }
          setBusinessAddress(profile.businessAddress ?? null);
          setBusinessEmail(profile.businessEmail ?? null);
          setBusinessPhone(profile.businessPhone ?? null);
          setBusinessAbn(profile.abn ?? null);
          if (!termsLoaded) {
            setTermsAndConditions(profile.termsAndConditions ?? "");
            setTermsLoaded(true);
          }
        }
        setServicesLoading(true);
        const servicesData = (await servicesRes.json()) as {
          ok?: boolean;
          services?: BusinessServiceDetail[];
        };
        if (servicesRes.ok && servicesData.ok && servicesData.services) {
          setServices(servicesData.services);
          if (servicesData.services.some((service) => service.isActive)) {
            setRequestType("existing_service");
          }
        }
        setServicesLoading(false);
      } catch {
        setServicesLoading(false);
        /* optional */
      }
    })();
  }, [user, termsLoaded]);

  function selectCustomer(option: CustomerOption) {
    setCustomer({
      fullName: option.fullName,
      email: option.email,
      phone: option.phone,
    });
    if (option.address) setAddress({ ...option.address });
    setCustomerSearch(option.fullName);
    setShowCustomerDropdown(false);
    setClientOpen(true);
  }

  function clearClient() {
    setCustomer({ fullName: "", email: "", phone: "" });
    setAddress({ ...EMPTY_ADDRESS });
    setCustomerSearch("");
    setClientOpen(false);
  }

  function startAddItem() {
    setCatalogSuggestField(null);
    setItemDraft({
      code: "",
      name: "",
      description: "",
      quantity: "1",
      rate: "",
      discountPercent: "0",
      applyGst: gstEnabled,
      showOptions: false,
    });
    setEditingItemId(null);
  }

  function startEditItem(item: SavedLineItem) {
    setCatalogSuggestField(null);
    setItemDraft({
      code: item.code ?? "",
      name: item.name ?? "",
      description: item.description ?? "",
      quantity: String(item.quantity ?? 1),
      rate: String(item.rate ?? ""),
      discountPercent: String(item.discountPercent ?? 0),
      applyGst: item.applyGst,
      showOptions: item.discountPercent > 0 || item.applyGst,
    });
    setEditingItemId(item.id);
  }

  async function commitItemDraft() {
    if (!itemDraft) return;
    const name = (itemDraft.name ?? "").trim();
    const code = (itemDraft.code ?? "").trim();
    const quantity = parseNum(itemDraft.quantity) || 1;
    const rate = parseNum(itemDraft.rate);
    const discountPercent = Math.min(100, parseNum(itemDraft.discountPercent));
    if (!name || rate <= 0) {
      setError("Enter an item name and rate.");
      return;
    }
    const amountAud = computeSavedLineAmount(
      {
        quantity,
        rate,
        discountPercent,
        applyGst: itemDraft.applyGst,
      },
      gstEnabled,
      gstPercentage,
      gstPricing,
    );
    const saved: SavedLineItem = {
      id: editingItemId ?? crypto.randomUUID(),
      code,
      name,
      description: (itemDraft.description ?? "").trim(),
      quantity,
      rate,
      discountPercent,
      applyGst: itemDraft.applyGst,
      amountAud,
    };
    if (editingItemId) {
      setLineItems((prev) =>
        prev.map((item) => (item.id === editingItemId ? saved : item)),
      );
    } else {
      setLineItems((prev) => [...prev, saved]);
    }
    setItemDraft(null);
    setEditingItemId(null);
    setCatalogSuggestField(null);
    setError(null);

    if (user) {
      try {
        const token = await user.getIdToken();
        await fetch("/api/items", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            priceAud: rate,
            code: code || null,
            description: (itemDraft.description ?? "").trim() || null,
          }),
        });
        await refreshCatalog(token);
      } catch {
        /* catalog save is best-effort */
      }
    }
  }

  function applyCatalogItem(item: CatalogItem) {
    setItemDraft((prev) =>
      prev
        ? {
            ...prev,
            code: item.code ?? "",
            name: item.name,
            description: item.description ?? "",
            rate: String(item.priceAud),
          }
        : prev,
    );
    setCatalogSuggestField(null);
  }

  function renderCatalogSuggestions(activeField: "code" | "name") {
    if (catalogSuggestField !== activeField || catalogSuggestions.length === 0) {
      return null;
    }
    const query =
      activeField === "code"
        ? (itemDraft?.code ?? "").trim()
        : (itemDraft?.name ?? "").trim();
    return (
      <ul
        role="listbox"
        className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-outline-variant bg-background py-1 shadow-lg"
      >
        {!query ? (
          <li className="px-3 py-1.5 font-body text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">
            Saved items
          </li>
        ) : null}
        {catalogSuggestions.map((item) => (
          <li key={item.id} role="option">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyCatalogItem(item)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-container-low"
            >
              <span className="min-w-0">
                <span className="block truncate font-body text-[13px] font-semibold text-on-surface">
                  {item.name}
                </span>
                {item.code ? (
                  <span className="font-body text-[11px] text-on-surface-variant">
                    {item.code}
                  </span>
                ) : null}
                {item.description ? (
                  <span className="mt-0.5 block truncate font-body text-[10px] text-on-surface-variant/80">
                    {item.description}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 font-numeric text-[12px] font-semibold text-primary">
                {formatAud(item.priceAud)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    setUploadingImage(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/uploads/quotation-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        imageUrl?: string;
      };
      if (!response.ok || !data.ok || !data.imageUrl) {
        throw new Error(data.error ?? "Could not upload file.");
      }
      setImageUrls((prev) => [...prev, data.imageUrl!].slice(0, 10));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload file.",
      );
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const validate = useCallback((): string | null => {
    if (customer.fullName.trim().length < 2) return "Add a client name.";
    if (!EMAIL_REGEX.test(customer.email.trim())) {
      return "Enter a valid client email.";
    }
    if (customer.phone.replace(/\D/g, "").length < 6) {
      return "Enter a valid client mobile number.";
    }
    if (address.street.trim().length < 3) return "Enter a complete address.";
    // Inspection-bound quotations inherit the service/job details from the
    // existing visit, so only validate them for standalone quotations.
    if (!inspectionRequestId) {
      if (requestType === "existing_service") {
        if (!selectedServiceId) return "Select a service from the list.";
      } else {
        if (customServiceTitle.trim().length < 3) {
          return "Add a job title (at least 3 characters).";
        }
        if (customServiceDescription.trim().length < 10) {
          return "Describe the work needed (at least 10 characters).";
        }
      }
    }
    if (lineItems.length === 0) return "Add at least one line item.";
    return null;
  }, [
    customer,
    address,
    lineItems,
    requestType,
    selectedServiceId,
    customServiceTitle,
    customServiceDescription,
    inspectionRequestId,
  ]);

  async function save(sendToCustomer = false) {
    if (!user) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setTab("create");
      return;
    }
    if (sendToCustomer && !customer.email.trim()) {
      setError("Add a client email before sending.");
      setTab("send");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const title =
        requestType === "existing_service"
          ? (selectedService?.name ?? "Quotation")
          : customServiceTitle.trim() ||
            lineItems[0]?.name.trim() ||
            "Custom quotation";
      const sharedBody = {
        customer: {
          fullName: customer.fullName.trim(),
          email: customer.email.trim().toLowerCase(),
          phone: customer.phone,
        },
        address,
        lineItems: lineItems.map((item) => ({
          code: (item.code ?? "").trim() || null,
          name: item.name,
          description: item.description || null,
          quantity: item.quantity,
          rateAud: item.rate,
          gstPercent: lineGstPercent(item.applyGst, gstEnabled, gstPercentage),
          priceAud: item.amountAud,
        })),
        finalPriceAud: total,
        discountAud: discountAmount,
        ...(previewServiceDescription
          ? { serviceDescription: previewServiceDescription }
          : {}),
        termsAndConditions: termsAndConditions.trim() || null,
        notes: comment.trim() || null,
        validUntil: dueDate,
        imageUrls,
        depositRequest: depositRequest
          ? {
              mode: depositRequest.mode,
              percent: depositRequest.percent,
              amountAud: depositRequest.amountAud,
              dueDate: depositRequest.dueDate,
            }
          : null,
      };

      // Bound to an existing request → attach the quotation to it.
      // Otherwise create a standalone quotation (with its own visit record).
      const quotationBody = inspectionRequestId
        ? { requestId: inspectionRequestId, send: sendToCustomer, ...sharedBody }
        : {
            standalone: true,
            send: sendToCustomer,
            requestType,
            serviceId:
              requestType === "existing_service" ? selectedServiceId : null,
            customRequest:
              requestType === "custom_quote"
                ? {
                    title: customServiceTitle.trim(),
                    description: customServiceDescription.trim(),
                  }
                : null,
            title,
            description: lineItems
              .map((item) =>
                item.description
                  ? `${item.name} — ${item.description}`
                  : item.name,
              )
              .join("; "),
            ...sharedBody,
          };

      const endpoint = draftQuotationId
        ? `/api/quotations/${encodeURIComponent(draftQuotationId)}`
        : "/api/quotations";
      const response = await fetch(endpoint, {
        method: draftQuotationId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          draftQuotationId
            ? { action: "save_draft", ...quotationBody }
            : quotationBody,
        ),
      });
      const responseText = await response.text();
      let payload: { ok?: boolean; error?: string };
      try {
        payload = responseText.trim()
          ? (JSON.parse(responseText) as { ok?: boolean; error?: string })
          : { ok: false, error: "Empty response from server." };
      } catch {
        payload = {
          ok: false,
          error: responseText.trim() || "Could not save quotation.",
        };
      }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save quotation.");
      }
      router.push("/dashboard/quotations");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save quotation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const businessName = business?.businessName ?? "Your business";
  const logoUrl = business?.logoUrl ?? null;

  const previewDocument = useMemo((): QuotationDocumentData => {
    return {
      quoteNo: "Draft",
      quoteDate: formatQuoteDate(quotationDate),
      validUntil: dueDate,
      serviceTitle: previewServiceTitle,
      serviceDescription: previewServiceDescription,
      customer: {
        fullName: customer.fullName.trim(),
        email: customer.email.trim(),
        phone: customer.phone,
      },
      customerAddress: address,
      lineItems: documentLineItems,
      subtotalAud: subtotal,
      discountAud: discountAmount,
      gstAud: gstAmount,
      totalAud: total,
      deposit: buildQuotationDocumentDeposit(total, depositRequest),
      termsAndConditions: termsAndConditions.trim() || null,
      paymentInstructions: null,
      notes: comment.trim() || null,
      business: {
        businessName,
        logoUrl,
        address: businessAddress,
        email: businessEmail,
        phone: businessPhone,
        abn: businessAbn,
        registeredForGst: gstEnabled,
        gstPercentage: gstEnabled ? gstPercentage : 0,
      },
    };
  }, [
    quotationDate,
    dueDate,
    previewServiceTitle,
    previewServiceDescription,
    customer,
    address,
    documentLineItems,
    subtotal,
    discountAmount,
    gstAmount,
    total,
    depositRequest,
    termsAndConditions,
    comment,
    businessName,
    logoUrl,
    businessAddress,
    businessEmail,
    businessPhone,
    businessAbn,
    gstEnabled,
    gstPricing,
    gstPercentage,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-outline-variant/60 bg-background/95 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard/quotations"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
              aria-label="Back to quotations"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </Link>
            <h1 className="truncate font-display text-[18px] font-semibold text-on-surface sm:text-[20px]">
              {draftQuotationId
                ? "Edit draft quotation"
                : boundInspection
                  ? "Quotation for visit"
                  : "Create a quotation"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/dashboard/quotations"
              className="hidden rounded-lg px-3 py-2 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low sm:inline"
            >
              Close
            </Link>
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={submitting || draftLoading}
              className="inline-flex min-w-[5.5rem] items-center justify-center rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting || draftLoading ? (
                <SaveSpinner label={draftLoading ? "Loading…" : "Saving…"} />
              ) : draftQuotationId ? (
                "Update draft"
              ) : (
                "Save draft"
              )}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex gap-0 border-t border-outline-variant/40 px-4 sm:px-6">
          {(
            [
              { id: "create" as const, label: "Create" },
              { id: "preview" as const, label: "Preview" },
              { id: "send" as const, label: "Send" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`relative px-4 py-3 font-body text-[14px] font-semibold transition-colors ${
                tab === item.id
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {item.label}
              {tab === item.id ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {boundInspection ? (
        <div className="mx-4 mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 font-body text-[13px] text-on-surface sm:mx-6">
          <div className="flex min-w-0 items-start gap-2">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[18px] text-primary">
              assignment_turned_in
            </span>
            <span>
              This quotation will be attached to request{" "}
              <span className="font-semibold">
                {boundInspection.requestCode ?? boundInspection.id}
              </span>
              . The customer details are pre-filled from the visit.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setRequestPickerOpen(true)}
            className="shrink-0 font-body text-[12px] font-semibold text-primary hover:underline"
          >
            Change request
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container sm:mx-6">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Main content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {tab === "create" ? (
            <div className="mx-auto max-w-2xl space-y-3">
              {requestPickerOpen ? (
                <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-body text-[15px] font-semibold text-on-surface">
                        Fetch from requests
                      </h2>
                      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                        Choose a request to fill the customer, address, and
                        service details. Existing quotation items will stay as
                        they are.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRequestPickerOpen(false)}
                      className="shrink-0 font-body text-[12px] font-semibold text-on-surface-variant hover:text-on-surface"
                    >
                      Close
                    </button>
                  </div>
                  <label className="mt-3 block">
                    <span className={LABEL_CLASS}>Search requests</span>
                    <input
                      type="text"
                      value={requestSearch}
                      onChange={(event) => setRequestSearch(event.target.value)}
                      placeholder="Search by request code, customer, phone, email, or service"
                      className={INPUT_CLASS}
                    />
                  </label>
                  {filteredRequests.length > 0 ? (
                    <ul className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-outline-variant/60 bg-surface-container-lowest">
                      {filteredRequests.map((request, index) => (
                        <li
                          key={request.id}
                          className={
                            index > 0 ? "border-t border-outline-variant/40" : ""
                          }
                        >
                          <button
                            type="button"
                            onClick={() => applyInspectionRequest(request)}
                            className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-surface-container-low"
                          >
                            <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-primary">
                              assignment
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[12px] font-semibold text-primary">
                                  {request.requestCode ?? request.id}
                                </span>
                                <span className="rounded-full bg-surface-container-low px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                                  {STATUS_LABELS[request.status]}
                                </span>
                              </span>
                              <span className="mt-1 block font-body text-[14px] font-semibold text-on-surface">
                                {request.customer.fullName || "Unknown customer"}
                              </span>
                              <span className="mt-0.5 block truncate font-body text-[12px] text-on-surface-variant">
                                {requestServiceTitle(request)}
                              </span>
                              <span className="mt-0.5 block truncate font-body text-[12px] text-on-surface-variant">
                                {formatCustomerContact(
                                  request.customer.phone,
                                  request.customer.email,
                                ) || formatAddress(request.address)}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[13px] text-on-surface-variant">
                      No available requests found. Requests with active
                      quotations, jobs, or cancellations are hidden to avoid
                      duplicate quotes.
                    </p>
                  )}
                </section>
              ) : !boundInspection ? (
                <SectionLink
                  icon="assignment"
                  label="Fetch from requests"
                  onClick={() => setRequestPickerOpen(true)}
                />
              ) : null}

              {/* Client */}
              {boundInspection && !clientOpen ? (
                <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-body text-[15px] font-semibold text-on-surface">
                        Client
                      </h2>
                      <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                        From the visit — saved with the quotation when you
                        draft or send.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setClientOpen(true)}
                      className="shrink-0 font-body text-[12px] font-semibold text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="mt-3 space-y-1 font-body text-[14px] text-on-surface">
                    <p className="font-semibold">
                      {customer.fullName.trim() || "—"}
                    </p>
                    {customer.phone ? (
                      <p className="text-on-surface-variant">
                        {formatAuPhoneDisplay(customer.phone)}
                      </p>
                    ) : null}
                    {customer.email ? (
                      <p className="text-on-surface-variant">{customer.email}</p>
                    ) : null}
                    {formatAddress(address) ? (
                      <p className="pt-1 text-[13px] text-on-surface-variant">
                        {formatAddress(address)}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : !clientOpen ? (
                <SectionLink
                  icon="person"
                  label="Add a client"
                  onClick={() => setClientOpen(true)}
                />
              ) : (
                <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-body text-[15px] font-semibold text-on-surface">
                      Client
                    </h2>
                    <button
                      type="button"
                      onClick={clearClient}
                      className="font-body text-[12px] font-semibold text-on-surface-variant hover:text-error"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="relative mt-3">
                    <label className="block">
                      <span className={LABEL_CLASS}>Client name</span>
                      <input
                        type="text"
                        value={customerSearch || customer.fullName}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setCustomer((prev) => ({
                            ...prev,
                            fullName: e.target.value,
                          }));
                          setShowCustomerDropdown(true);
                        }}
                        onFocus={() => setShowCustomerDropdown(true)}
                        placeholder="Search or enter name"
                        className={INPUT_CLASS}
                      />
                    </label>
                    {showCustomerDropdown && filteredCustomers.length > 0 ? (
                      <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg">
                        <li className="border-b border-outline-variant/40 px-3 py-2 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                          Recently created
                        </li>
                        {filteredCustomers.map((option) => (
                          <li key={option.id}>
                            <button
                              type="button"
                              onClick={() => selectCustomer(option)}
                              className="flex w-full flex-col px-3 py-2.5 text-left transition-colors hover:bg-surface-container-low"
                            >
                              <span className="font-body text-[14px] font-semibold text-on-surface">
                                {option.fullName}
                              </span>
                              {option.email ? (
                                <span className="font-body text-[12px] text-on-surface-variant">
                                  {option.email}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className={LABEL_CLASS}>Mobile</span>
                      <AuPhoneInput
                        value={customer.phone}
                        onChange={(phone) =>
                          setCustomer((prev) => ({
                            ...prev,
                            phone,
                          }))
                        }
                        className="mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className={LABEL_CLASS}>Email</span>
                      <input
                        type="email"
                        value={customer.email}
                        onChange={(e) =>
                          setCustomer((prev) => ({
                            ...prev,
                            email: e.target.value,
                          }))
                        }
                        className={INPUT_CLASS}
                      />
                    </label>
                  </div>

                  <div className="mt-4 border-t border-outline-variant/40 pt-4">
                    <p className={LABEL_CLASS}>Bill to</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className="block sm:col-span-2">
                        <span className={LABEL_CLASS}>Street</span>
                        <input
                          type="text"
                          value={address.street}
                          onChange={(e) =>
                            setAddress((prev) => ({
                              ...prev,
                              street: e.target.value,
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className={LABEL_CLASS}>Suburb</span>
                        <input
                          type="text"
                          value={address.suburb}
                          onChange={(e) =>
                            setAddress((prev) => ({
                              ...prev,
                              suburb: e.target.value,
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className={LABEL_CLASS}>State</span>
                        <input
                          type="text"
                          value={address.state}
                          onChange={(e) =>
                            setAddress((prev) => ({
                              ...prev,
                              state: e.target.value,
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </label>
                      <label className="block sm:max-w-[8rem]">
                        <span className={LABEL_CLASS}>Postcode</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={address.postcode}
                          onChange={(e) =>
                            setAddress((prev) => ({
                              ...prev,
                              postcode: e.target.value
                                .replace(/\D/g, "")
                                .slice(0, 4),
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </label>
                    </div>
                  </div>
                </section>
              )}

              {/* Service */}
              {boundInspection &&
              !serviceEditing &&
              ((requestType === "existing_service" && selectedService) ||
                (requestType === "custom_quote" &&
                  customServiceTitle.trim().length > 0)) ? (
                <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-body text-[15px] font-semibold text-on-surface">
                      Service
                    </h2>
                    <button
                      type="button"
                      onClick={() => setServiceEditing(true)}
                      className="shrink-0 font-body text-[12px] font-semibold text-primary hover:underline"
                    >
                      Change
                    </button>
                  </div>
                  {requestType === "existing_service" && selectedService ? (
                    <div className="mt-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-container">
                        {selectedService.imageUrl ? (
                          <img
                            src={selectedService.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <span className="material-symbols-outlined material-symbols-filled text-[28px] text-on-surface-variant">
                              {iconForBusinessType(selectedService.businessType)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-body text-[14px] font-semibold text-on-surface">
                          {selectedService.name}
                        </p>
                        <p className="font-body text-[12px] text-on-surface-variant">
                          {selectedService.businessType}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                      <p className="font-body text-[14px] font-semibold text-on-surface">
                        {customServiceTitle.trim()}
                      </p>
                      {customServiceDescription.trim() ? (
                        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                          {customServiceDescription.trim()}
                        </p>
                      ) : null}
                    </div>
                  )}
                </section>
              ) : (
              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Service
                </h2>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  Choose an existing service or describe a custom job — same as
                  an request.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <RequestTypeCard
                    icon="format_list_bulleted"
                    label="Existing service"
                    description="Pick from the services this business offers."
                    selected={requestType === "existing_service"}
                    disabled={servicesLoading || activeServices.length === 0}
                    onSelect={() => {
                      setRequestType("existing_service");
                      setError(null);
                    }}
                  />
                  <RequestTypeCard
                    icon="request_quote"
                    label="Custom quote"
                    description="Describe the work for this quotation."
                    selected={requestType === "custom_quote"}
                    onSelect={() => {
                      setRequestType("custom_quote");
                      setError(null);
                    }}
                  />
                </div>

                {requestType === "existing_service" ? (
                  activeServices.length > 0 ? (
                    <ul className="mt-3 overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest">
                      {activeServices.map((service, index) => {
                        const selected = selectedServiceId === service.id;
                        return (
                          <li
                            key={service.id}
                            className={
                              index > 0
                                ? "border-t border-outline-variant/40"
                                : ""
                            }
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedServiceId(
                                  selectedServiceId === service.id
                                    ? null
                                    : service.id,
                                );
                                setError(null);
                              }}
                              className={`flex w-full items-center gap-3 p-3 text-left transition-colors sm:p-4 ${
                                selected
                                  ? "bg-primary/5"
                                  : "hover:bg-surface-container"
                              }`}
                            >
                              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-surface-container">
                                {service.imageUrl ? (
                                  <img
                                    src={service.imageUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center">
                                    <span className="material-symbols-outlined material-symbols-filled text-[28px] text-on-surface-variant">
                                      {iconForBusinessType(service.businessType)}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <span className="min-w-0 flex-1">
                                <span className="block font-body text-[14px] font-semibold text-on-surface">
                                  {service.name}
                                </span>
                                <span className="font-body text-[12px] text-on-surface-variant">
                                  {service.businessType}
                                </span>
                              </span>
                              {selected ? (
                                <span className="material-symbols-outlined material-symbols-filled shrink-0 text-[20px] text-primary">
                                  check_circle
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : servicesLoading ? (
                    <p className="mt-3 font-body text-[13px] text-on-surface-variant">
                      Loading services…
                    </p>
                  ) : (
                    <p className="mt-3 font-body text-[13px] text-on-surface-variant">
                      No active services yet — use a custom quote instead.
                    </p>
                  )
                ) : (
                  <div className="mt-3 grid gap-3">
                    <label className="block">
                      <span className={LABEL_CLASS}>Job title</span>
                      <input
                        type="text"
                        value={customServiceTitle}
                        onChange={(e) => {
                          setCustomServiceTitle(e.target.value);
                          setError(null);
                        }}
                        placeholder="e.g. Replace kitchen tap and check leak"
                        className={INPUT_CLASS}
                        maxLength={120}
                      />
                    </label>
                    <label className="block">
                      <span className={LABEL_CLASS}>What needs doing?</span>
                      <textarea
                        value={customServiceDescription}
                        onChange={(e) => {
                          setCustomServiceDescription(e.target.value);
                          setError(null);
                        }}
                        rows={4}
                        placeholder="Tell us the scope, materials involved, urgency, etc."
                        className={`${INPUT_CLASS} resize-y`}
                        maxLength={1500}
                      />
                      <p className="mt-1 font-body text-[11px] text-on-surface-variant">
                        At least 10 characters (
                        {customServiceDescription.trim().length}/10).
                      </p>
                    </label>
                  </div>
                )}
              </section>
              )}

              {/* Items */}
              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Items
                </h2>

                {lineItems.length > 0 ? (
                  <ul className="mt-3 divide-y divide-outline-variant/40">
                    {lineItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start justify-between gap-3 py-3 first:pt-0"
                      >
                        <button
                          type="button"
                          onClick={() => startEditItem(item)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="font-body text-[14px] font-semibold text-on-surface">
                            {item.code ? (
                              <span className="font-numeric text-on-surface-variant">
                                {item.code}
                                {" · "}
                              </span>
                            ) : null}
                            {item.name}
                          </p>
                          {item.description ? (
                            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                              {item.description}
                            </p>
                          ) : null}
                          <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                            {item.quantity} × {formatAud(item.rate)}
                            {item.discountPercent > 0
                              ? ` · ${item.discountPercent}% off`
                              : ""}
                            {item.applyGst && gstEnabled
                              ? ` · GST ${gstPercentage}%`
                              : ""}
                          </p>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-numeric text-[14px] font-semibold text-on-surface">
                            {formatAud(item.amountAud)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setLineItems((prev) =>
                                prev.filter((row) => row.id !== item.id),
                              )
                            }
                            className="text-on-surface-variant hover:text-error"
                            aria-label="Remove item"
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              close
                            </span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {itemDraft ? (
                  <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <label className="block">
                      <span className={LABEL_CLASS}>Item code</span>
                      <div className="relative">
                        <input
                          type="text"
                          value={itemDraft.code ?? ""}
                          onChange={(e) =>
                            setItemDraft((prev) =>
                              prev ? { ...prev, code: e.target.value } : prev,
                            )
                          }
                          onFocus={() => setCatalogSuggestField("code")}
                          onBlur={() => {
                            window.setTimeout(
                              () =>
                                setCatalogSuggestField((field) =>
                                  field === "code" ? null : field,
                                ),
                              150,
                            );
                          }}
                          placeholder="e.g. TAP-001"
                          className={INPUT_CLASS}
                          autoComplete="off"
                          autoFocus
                        />
                        {renderCatalogSuggestions("code")}
                      </div>
                    </label>
                    <label className="mt-3 block">
                      <span className={LABEL_CLASS}>Item name</span>
                      <div className="relative">
                        <input
                          type="text"
                          value={itemDraft.name ?? ""}
                          onChange={(e) =>
                            setItemDraft((prev) =>
                              prev ? { ...prev, name: e.target.value } : prev,
                            )
                          }
                          onFocus={() => setCatalogSuggestField("name")}
                          onBlur={() => {
                            window.setTimeout(
                              () =>
                                setCatalogSuggestField((field) =>
                                  field === "name" ? null : field,
                                ),
                              150,
                            );
                          }}
                          className={INPUT_CLASS}
                          autoComplete="off"
                        />
                        {renderCatalogSuggestions("name")}
                      </div>
                      {catalog.length > 0 ? (
                        <p className="mt-1 font-body text-[11px] text-on-surface-variant">
                          Type or focus to search {catalog.length} saved item
                          {catalog.length === 1 ? "" : "s"}.
                        </p>
                      ) : null}
                    </label>
                    <label className="mt-3 block">
                      <span className={LABEL_CLASS}>Item description</span>
                      <input
                        type="text"
                        value={itemDraft.description ?? ""}
                        onChange={(e) =>
                          setItemDraft((prev) =>
                            prev
                              ? { ...prev, description: e.target.value }
                              : prev,
                          )
                        }
                        className={INPUT_CLASS}
                      />
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className={LABEL_CLASS}>Quantity</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={itemDraft.quantity ?? "1"}
                          onChange={(e) =>
                            setItemDraft((prev) =>
                              prev
                                ? { ...prev, quantity: e.target.value }
                                : prev,
                            )
                          }
                          className={NUMBER_INPUT_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className={LABEL_CLASS}>
                          Rate
                          {gstEnabled
                            ? gstPricing === "inclusive"
                              ? " (inc. GST)"
                              : " (ex. GST)"
                            : ""}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={itemDraft.rate ?? ""}
                          onChange={(e) =>
                            setItemDraft((prev) =>
                              prev ? { ...prev, rate: e.target.value } : prev,
                            )
                          }
                          className={NUMBER_INPUT_CLASS}
                        />
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setItemDraft((prev) =>
                          prev
                            ? { ...prev, showOptions: !prev.showOptions }
                            : prev,
                        )
                      }
                      className="mt-3 font-body text-[13px] font-semibold text-primary"
                    >
                      GST, discount
                    </button>

                    {itemDraft.showOptions ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-3">
                        {gstEnabled ? (
                          <label className="flex items-center gap-2 font-body text-[13px] text-on-surface">
                            <input
                              type="checkbox"
                              checked={itemDraft.applyGst}
                              onChange={(e) =>
                                setItemDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        applyGst: e.target.checked,
                                      }
                                    : prev,
                                )
                              }
                              className="rounded border-outline-variant"
                            />
                            Apply GST ({gstPercentage}%)
                          </label>
                        ) : null}
                        <label className="block">
                          <span className={LABEL_CLASS}>Discount (%)</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={itemDraft.discountPercent ?? "0"}
                            onChange={(e) =>
                              setItemDraft((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      discountPercent: e.target.value,
                                    }
                                  : prev,
                              )
                            }
                            className={NUMBER_INPUT_CLASS}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="mt-4 flex items-center justify-end gap-2">
                      <span className="mr-auto font-numeric text-[14px] font-semibold text-on-surface">
                        {formatAud(
                          (() => {
                            const quantity = parseNum(itemDraft.quantity) || 1;
                            const rate = parseNum(itemDraft.rate);
                            const discountPercent = parseNum(
                              itemDraft.discountPercent,
                            );
                            const gstPercent = lineGstPercent(
                              itemDraft.applyGst,
                              gstEnabled,
                              gstPercentage,
                            );
                            const { amountAud } = computeQuotationLineAmounts({
                              quantity,
                              rate,
                              discountPercent,
                              gstPercent,
                              gstPricing,
                            });
                            if (gstPercent <= 0) return amountAud;
                            if (gstPricing === "inclusive") {
                              return lineAmount(quantity, rate, discountPercent);
                            }
                            return (
                              Math.round(
                                amountAud * (1 + gstPercent / 100) * 100,
                              ) / 100
                            );
                          })(),
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setItemDraft(null);
                          setEditingItemId(null);
                          setCatalogSuggestField(null);
                        }}
                        className="rounded-lg px-3 py-2 font-body text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container-low"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void commitItemDraft()}
                        className="rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
                      >
                        {editingItemId ? "Update" : "Add"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startAddItem}
                    className="mt-3 inline-flex items-center gap-1.5 font-body text-[14px] font-semibold text-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      add
                    </span>
                    Add items
                  </button>
                )}
              </section>

              {/* Attachments */}
              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Attachments
                </h2>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  Add photos or PDF documents (max 10 files).
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => void uploadAttachment(e)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage || imageUrls.length >= 10}
                  className="mt-3 inline-flex items-center gap-2 font-body text-[14px] font-semibold text-primary disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    attach_file
                  </span>
                  {uploadingImage ? "Uploading…" : "Add photos or PDFs"}
                </button>
                {imageUrls.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {imageUrls.map((url, index) => (
                      <li key={url} className="relative">
                        {isPdfAttachmentUrl(url) ? (
                          <div className="flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-outline-variant/60 bg-surface-container-low px-2">
                            <span className="material-symbols-outlined text-[24px] text-primary">
                              picture_as_pdf
                            </span>
                            <span className="max-w-full truncate font-body text-[9px] text-on-surface-variant">
                              {attachmentDisplayName(url)}
                            </span>
                          </div>
                        ) : (
                          <img
                            src={url}
                            alt=""
                            className="h-16 w-16 rounded-lg border border-outline-variant/60 object-cover"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setImageUrls((prev) =>
                              prev.filter((_, idx) => idx !== index),
                            )
                          }
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-on-surface text-surface"
                          aria-label="Remove attachment"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            close
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              {/* Terms and conditions */}
              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-body text-[15px] font-semibold text-on-surface">
                    Terms and conditions
                  </h2>
                  <Link
                    href="/dashboard/settings"
                    className="font-body text-[12px] font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
                  >
                    Edit default in Settings
                  </Link>
                </div>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  Pre-filled from your business settings. Changes here apply to
                  this quotation only.
                </p>
                <label className="mt-3 block">
                  <textarea
                    value={termsAndConditions}
                    onChange={(e) => setTermsAndConditions(e.target.value)}
                    rows={6}
                    maxLength={5000}
                    placeholder="Payment terms, warranty, cancellation policy, etc."
                    className={`${INPUT_CLASS} resize-y leading-relaxed`}
                  />
                </label>
              </section>

              {/* Comments */}
              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Comments
                </h2>
                <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                  Optional notes for the customer. Shown on the quotation PDF
                  and preview.
                </p>
                <label className="mt-3 block">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Add a comment for this quotation…"
                    className={`${INPUT_CLASS} resize-y leading-relaxed`}
                  />
                </label>
              </section>
            </div>
          ) : null}

          {tab === "preview" ? (
            <div className="mx-auto w-full max-w-3xl space-y-4 px-2 pb-8">
              <p className="text-center font-body text-[12px] text-on-surface-variant">
                This preview matches the PDF that will be generated when you
                save, including your business logo.
              </p>
              <QuotationDocumentPreview document={previewDocument} />
            </div>
          ) : null}

          {tab === "send" ? (
            <div className="mx-auto max-w-2xl space-y-4">
              <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <label className="block">
                  <span className={LABEL_CLASS}>To</span>
                  <input
                    type="email"
                    readOnly
                    value={customer.email}
                    className={`${INPUT_CLASS} bg-surface-container-low`}
                  />
                </label>
                <label className="mt-3 block">
                  <span className={LABEL_CLASS}>Subject</span>
                  <input
                    type="text"
                    readOnly
                    value={`Quotation from ${businessName}`}
                    className={`${INPUT_CLASS} bg-surface-container-low`}
                  />
                </label>
                <label className="mt-3 block">
                  <span className={LABEL_CLASS}>Message</span>
                  <textarea
                    readOnly
                    rows={4}
                    value={`Thank you for your business. Please find your quotation attached.\n\nTotal: ${formatAud(total)}`}
                    className={`${INPUT_CLASS} resize-none bg-surface-container-low`}
                  />
                </label>
              </div>
              <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container/50 px-3 py-2.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
                Use <strong>Save</strong> to keep a draft. The quotation PDF is
                emailed to the client only when you click{" "}
                <strong>Save &amp; send quotation</strong> below.
              </p>
              <button
                type="button"
                onClick={() => void save(true)}
                disabled={submitting || draftLoading || !customer.email.trim()}
                className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50 sm:max-w-xs"
              >
                {submitting || draftLoading ? (
                  <SaveSpinner label={draftLoading ? "Loading…" : "Sending…"} />
                ) : (
                  "Save & send quotation"
                )}
              </button>
            </div>
          ) : null}
        </div>

        {/* Sidebar summary */}
        <aside className="shrink-0 border-t border-outline-variant/60 bg-gradient-to-b from-[#edf4ff]/30 to-surface-container-low px-3 py-3 lg:w-[23rem] lg:border-l lg:border-t-0 lg:px-4 lg:py-4 xl:w-[26rem]">
          <div className="space-y-3">
            {/* Schedule */}
            <div className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-3 shadow-sm">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="font-body text-[12px] font-bold text-on-surface">
                  Draft quotation
                </p>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 font-body text-[9px] font-bold uppercase tracking-wide text-amber-700">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  Unsent
                </span>
              </div>

              <div className="space-y-2.5">
                <MonthCalendarField
                  label="Quote date"
                  selectedIso={quotationDate}
                  minDate={minQuotationDate}
                  onSelect={setQuotationDate}
                />

                <label className="block">
                  <span className={LABEL_CLASS}>Payment terms</span>
                  <div className="relative mt-0.5">
                    <select
                      value={terms}
                      onChange={(e) => setTerms(e.target.value as TermsId)}
                      className={`${INPUT_CLASS} appearance-none py-1.5 pr-9 text-[13px]`}
                    >
                      {TERMS_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {formatTermsLabel(opt.days)}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-on-surface-variant">
                      expand_more
                    </span>
                  </div>
                </label>

                <div className="flex items-center justify-between gap-2 rounded-lg bg-primary/[0.06] px-2.5 py-2">
                  <span className="font-body text-[11px] font-semibold text-on-surface-variant">
                    Due date
                  </span>
                  <span className="font-numeric text-[13px] font-bold text-on-surface">
                    {formatQuoteDate(dueDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Totals */}
            <div className="overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container-lowest shadow-sm">
              <div className="space-y-1.5 px-3 py-2.5 font-body text-[12px]">
                <div className="flex justify-between text-on-surface-variant">
                  <span>Subtotal</span>
                  <span className="font-numeric font-medium text-on-surface">
                    {formatAud(subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDiscountModalOpen(true)}
                    className="font-body text-[12px] text-on-surface-variant underline underline-offset-2 hover:text-primary"
                  >
                    Discount
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountModalOpen(true)}
                    className="font-numeric text-[13px] font-medium text-on-surface hover:text-primary"
                  >
                    {discountAmount > 0
                      ? `−${formatAud(discountAmount)}`
                      : formatAud(0)}
                  </button>
                </div>
                {documentDiscount && discountAmount > 0 ? (
                  <p className="text-right font-body text-[10px] text-on-surface-variant">
                    {documentDiscount.mode === "percent"
                      ? `${documentDiscount.percent}% off subtotal`
                      : "Fixed discount"}
                  </p>
                ) : null}
                <div className="rounded-xl border border-outline-variant/40 bg-gradient-to-br from-surface-container-lowest to-surface-container-low/80 p-2.5">
                  <button
                    type="button"
                    onClick={() => setGstEnabled((value) => !value)}
                    aria-pressed={gstEnabled}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-all duration-300 ease-out ${
                      gstEnabled
                        ? "bg-[#1a1f28] text-white shadow-md shadow-black/15"
                        : "bg-white hover:bg-surface-container-low"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-300 ${
                          gstEnabled ? "bg-white/10" : "bg-primary/10"
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-[18px] ${
                            gstEnabled ? "text-white" : "text-primary"
                          }`}
                        >
                          receipt_long
                        </span>
                      </span>
                      <span className="text-left">
                        <span className="block font-body text-[12px] font-bold">
                          Apply GST ({gstPercentage}%)
                        </span>
                        <span
                          className={`block font-body text-[10px] ${
                            gstEnabled
                              ? "text-white/65"
                              : "text-on-surface-variant"
                          }`}
                        >
                          {gstEnabled
                            ? "GST is included in totals"
                            : "Tap to add GST to this quote"}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ease-out ${
                        gstEnabled
                          ? "scale-100 border-white bg-white text-[#1a1f28]"
                          : "scale-95 border-outline-variant/80 bg-transparent"
                      }`}
                    >
                      {gstEnabled ? (
                        <span className="material-symbols-outlined text-[15px] font-bold">
                          check
                        </span>
                      ) : null}
                    </span>
                  </button>

                  {gstEnabled ? (
                    <div className="mt-2.5 px-0.5">
                      <span className={LABEL_CLASS}>Prices are</span>
                      <div className="relative mt-1 grid grid-cols-2 rounded-full bg-[#1a1f28] p-1">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-y-1 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] transition-[left] duration-300 ease-out"
                          style={{
                            width: "calc(50% - 4px)",
                            left:
                              gstPricing === "inclusive" ? "calc(50%)" : "4px",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setGstPricing("exclusive")}
                          className={`relative z-10 rounded-full px-2 py-2 font-body text-[11px] font-semibold transition-colors duration-300 ${
                            gstPricing === "exclusive"
                              ? "text-[#1a1f28]"
                              : "text-white/75 hover:text-white"
                          }`}
                        >
                          Exclusive
                        </button>
                        <button
                          type="button"
                          onClick={() => setGstPricing("inclusive")}
                          className={`relative z-10 rounded-full px-2 py-2 font-body text-[11px] font-semibold transition-colors duration-300 ${
                            gstPricing === "inclusive"
                              ? "text-[#1a1f28]"
                              : "text-white/75 hover:text-white"
                          }`}
                        >
                          Inclusive
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                {gstEnabled ? (
                  <div className="flex justify-between text-on-surface-variant">
                    <span>GST ({gstPercentage}%)</span>
                    <span className="font-numeric font-medium text-on-surface">
                      {formatAud(gstAmount)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="space-y-1 border-t border-outline-variant/30 px-3 py-2 font-body text-[12px]">
                <div className="flex justify-between font-semibold text-on-surface">
                  <span>Total</span>
                  <span className="font-numeric">{formatAud(total)}</span>
                </div>
                {depositPaidAud > 0 ? (
                  <div className="flex justify-between text-on-surface-variant">
                    <span>Paid (deposit)</span>
                    <span className="font-numeric font-medium text-on-surface">
                      {formatAud(depositPaidAud)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between bg-[#1a1f28] px-3 py-2.5">
                <span className="font-body text-[12px] font-bold text-white">
                  {depositPaidAud > 0 ? "Balance due" : "Total due"}
                </span>
                <span className="font-numeric text-[15px] font-bold text-white">
                  {formatAud(depositPaidAud > 0 ? balanceDueAud : total)}
                </span>
              </div>
              <div className="border-t border-outline-variant/30 px-3 py-2.5 text-center">
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(true)}
                  className="font-body text-[13px] font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  {depositRequest
                    ? "Edit deposit request"
                    : "Add deposit request"}
                </button>
                {depositRequest ? (
                  <p className="mt-1 font-body text-[10px] text-on-surface-variant">
                    {depositRequest.mode === "percent"
                      ? `${depositRequest.percent}% deposit`
                      : "Fixed deposit"}{" "}
                    · due {formatQuoteDate(depositRequest.dueDate)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </aside>

        <DiscountEditModal
          open={discountModalOpen}
          subtotalAud={subtotal}
          initial={documentDiscount}
          onClose={() => setDiscountModalOpen(false)}
          onSave={setDocumentDiscount}
        />

        <DepositRequestModal
          open={depositModalOpen}
          quotationTotalAud={total}
          initial={depositRequest}
          defaultDueDate={dueDate}
          minDueDate={quotationDate}
          onClose={() => setDepositModalOpen(false)}
          onSave={setDepositRequest}
        />
      </div>
    </div>
  );
}
