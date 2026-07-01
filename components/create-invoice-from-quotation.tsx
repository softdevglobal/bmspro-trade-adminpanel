"use client";

import { AuPhoneInput } from "@/components/au-phone-input";

import {
  DepositRequestModal,
  type DepositRequest,
} from "@/components/deposit-request-modal";
import {
  DiscountEditModal,
  type DocumentDiscount,
} from "@/components/discount-edit-modal";
import { MonthCalendarField } from "@/components/month-calendar-field";
import { QuotationDocumentPreview } from "@/components/quotation-document-preview";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { printDocumentPreview } from "@/lib/pdf/print-document-preview";
import {
  buildCustomerOptions,
  filterCustomerOptions,
  type CustomerOption,
} from "@/lib/inspection/customer-options";
import { useInspectionRequests } from "@/lib/inspection/use-inspection-requests";
import type { InvoiceDetail } from "@/lib/invoices/types";
import {
  formatAddress,
  type InspectionAddress,
  type InspectionRequestType,
} from "@/lib/inspection/types";
import type { BusinessServiceDetail } from "@/lib/onboarding/services/display";
import { platformTodayIso } from "@/lib/platform/timezone";
import {
  buildQuotationDocumentDeposit,
  computeDocumentTotals,
  computeQuotationLineAmounts,
  formatDepositPaymentNote,
  formatQuoteDate,
  type GstPricingMode,
  type QuotationDocumentData,
  type QuotationDocumentLineItem,
} from "@/lib/quotations/document";
import type { QuotationDetail, QuotationLineItem } from "@/lib/quotations/types";
import {
  buildInvoiceCodeForQuotation,
  displayQuotationCode,
} from "@/lib/reference-codes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "create" | "preview" | "send";

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

type CatalogItem = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  priceAud: number;
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

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10";

const NUMBER_INPUT_CLASS = `${INPUT_CLASS} [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const LABEL_CLASS =
  "font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant";

function parseNum(value: string): number {
  const n = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

function todayIso(timeZone?: string | null): string {
  return platformTodayIso(new Date(), timeZone);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function quotationLineToSaved(
  item: QuotationLineItem,
  index: number,
): SavedLineItem {
  const quantity = item.quantity ?? 1;
  let discountPercent =
    typeof item.discountPercent === "number" && item.discountPercent > 0
      ? Math.min(100, item.discountPercent)
      : 0;
  const unitRate =
    item.rateAud ??
    (quantity > 0
      ? Math.round((item.priceAud / quantity) * 100) / 100
      : item.priceAud);

  if (discountPercent <= 0 && unitRate > 0 && quantity > 0) {
    const gross = Math.round(unitRate * quantity * 100) / 100;
    if (gross > item.priceAud + 0.01) {
      const inferred = Math.min(
        100,
        Math.round((1 - item.priceAud / gross) * 10000) / 100,
      );
      if (inferred > 0.01) discountPercent = inferred;
    }
  }

  let rate: number;
  if (
    discountPercent > 0 &&
    typeof item.discountPercent === "number" &&
    item.discountPercent > 0
  ) {
    rate =
      Math.round((unitRate / (1 - discountPercent / 100)) * 100) / 100;
  } else {
    rate = unitRate;
  }

  return {
    id: `line-${index}-${Math.random().toString(36).slice(2, 8)}`,
    code: item.code?.trim() ?? "",
    name: item.name,
    description: item.description?.trim() ?? "",
    quantity,
    rate,
    discountPercent,
    applyGst: (item.gstPercent ?? 0) > 0,
    amountAud: item.priceAud,
  };
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

function toApiLineItems(
  items: SavedLineItem[],
  gstEnabled: boolean,
  gstPercentage: number,
  gstPricing: GstPricingMode,
): QuotationLineItem[] {
  return items.map((item) => {
    const gstPercent = lineGstPercent(item.applyGst, gstEnabled, gstPercentage);
    const { amountAud, listRateAudExGst } = computeQuotationLineAmounts({
      quantity: item.quantity,
      rate: item.rate,
      discountPercent: item.discountPercent,
      gstPercent,
      gstPricing,
    });
    return {
      code: item.code.trim() || null,
      name: item.name.trim(),
      description: item.description.trim() || null,
      quantity: item.quantity,
      rateAud: listRateAudExGst,
      discountPercent: item.discountPercent > 0 ? item.discountPercent : null,
      gstPercent,
      priceAud: amountAud,
    };
  });
}

export function CreateInvoiceFromQuotation({
  quotationId = "",
  draftInvoiceId = "",
  direct = false,
}: {
  quotationId?: string;
  /** Existing draft invoice to edit and optionally send. */
  draftInvoiceId?: string;
  /** Create an invoice from scratch — no existing quotation. */
  direct?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const business = useBusinessProfile();
  const { requests } = useInspectionRequests();
  const timeZone = business?.timezone;

  const [tab, setTab] = useState<Tab>("create");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [draftInvoice, setDraftInvoice] = useState<InvoiceDetail | null>(null);

  const [requestType, setRequestType] =
    useState<InspectionRequestType>("custom_quote");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [customServiceTitle, setCustomServiceTitle] = useState("");
  const [customServiceDescription, setCustomServiceDescription] = useState("");
  const [services, setServices] = useState<BusinessServiceDetail[]>([]);
  const [, setServicesLoading] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [address, setAddress] = useState<InspectionAddress>({
    street: "",
    suburb: "",
    state: "",
    postcode: "",
  });
  const [lineItems, setLineItems] = useState<SavedLineItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogSuggestField, setCatalogSuggestField] = useState<
    "code" | "name" | null
  >(null);
  const [itemDraft, setItemDraft] = useState<DraftLineItem | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [discount, setDiscount] = useState<DocumentDiscount | null>(null);
  const [deposit, setDeposit] = useState<DepositRequest | null>(null);
  const [depositPaid, setDepositPaid] = useState(false);
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso(timeZone));
  const [dueDate, setDueDate] = useState(addDaysIso(todayIso(timeZone), 14));

  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [depositModalOpen, setDepositModalOpen] = useState(false);

  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstPercentage, setGstPercentage] = useState(10);
  const [gstPricing, setGstPricing] =
    useState<GstPricingMode>("exclusive");
  const [businessAddress, setBusinessAddress] = useState<string | null>(null);
  const [businessEmail, setBusinessEmail] = useState<string | null>(null);
  const [businessPhone, setBusinessPhone] = useState<string | null>(null);
  const [businessAbn, setBusinessAbn] = useState<string | null>(null);
  const isEditingDraftInvoice = draftInvoiceId.trim().length > 0;

  const loadQuotation = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const sourceQuotationId = isEditingDraftInvoice
        ? draftInvoiceId.trim()
        : quotationId.trim();
      const [draftInvoiceRes, quotationRes, profileRes, itemsRes, servicesRes] =
        await Promise.all([
          isEditingDraftInvoice
            ? fetch(
                `/api/invoices?invoiceId=${encodeURIComponent(
                  draftInvoiceId.trim(),
                )}`,
                {
                  headers: { Authorization: `Bearer ${token}` },
                  cache: "no-store",
                },
              )
            : Promise.resolve(null),
          direct && !isEditingDraftInvoice
            ? Promise.resolve(null)
            : fetch(
                `/api/quotations?quotationId=${encodeURIComponent(
                  sourceQuotationId,
                )}`,
                {
                  headers: { Authorization: `Bearer ${token}` },
                  cache: "no-store",
                },
              ),
          fetch("/api/business/profile", {
            headers: { authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/items", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          direct || isEditingDraftInvoice
            ? fetch("/api/services", {
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              })
            : Promise.resolve(null),
        ]);

      let loadedDraftInvoice: InvoiceDetail | null = null;
      if (draftInvoiceRes) {
        const invoiceBody = (await draftInvoiceRes.json()) as {
          ok?: boolean;
          error?: string;
          invoice?: InvoiceDetail;
        };
        if (!draftInvoiceRes.ok || !invoiceBody.ok || !invoiceBody.invoice) {
          throw new Error(invoiceBody.error ?? "Could not load draft invoice.");
        }
        if (invoiceBody.invoice.status !== "draft") {
          throw new Error("Only draft invoices can be edited.");
        }
        loadedDraftInvoice = invoiceBody.invoice;
        setDraftInvoice(loadedDraftInvoice);
      } else {
        setDraftInvoice(null);
      }

      if (quotationRes) {
        const quotationBody = (await quotationRes.json()) as {
          ok?: boolean;
          error?: string;
          quotation?: QuotationDetail;
        };
        if (!quotationRes.ok || !quotationBody.ok || !quotationBody.quotation) {
          throw new Error(quotationBody.error ?? "Could not load quotation.");
        }

        const q = quotationBody.quotation;
        setQuotation(q);
        setCustomerName(q.customer.fullName);
        setCustomerEmail(q.customer.email);
        setCustomerPhone(q.customer.phone);
        setCustomerSearch(q.customer.fullName);
        setAddress(q.address);
        setLineItems(q.lineItems.map(quotationLineToSaved));
        if (q.discountAud > 0) {
          setDiscount({ mode: "fixed", percent: 0, amountAud: q.discountAud });
        }
        if (q.depositRequest) {
          setDeposit({
            mode: q.depositRequest.mode,
            percent: q.depositRequest.percent,
            amountAud: q.depositRequest.amountAud,
            dueDate: q.depositRequest.dueDate,
          });
        }
        const rawTerms =
          q.termsAndConditions?.trim() || q.paymentInstructions?.trim() || "";
        const loadedDeposit = q.depositRequest
          ? {
              mode: q.depositRequest.mode,
              percent: q.depositRequest.percent,
              amountAud: q.depositRequest.amountAud,
              dueDate: q.depositRequest.dueDate,
            }
          : null;
        if (loadedDeposit) {
          const depositNote = formatDepositPaymentNote(loadedDeposit);
          setTermsAndConditions(
            rawTerms.replace(depositNote, "").replace(/\n{3,}/g, "\n\n").trim(),
          );
        } else {
          setTermsAndConditions(rawTerms);
        }
        setNotes(q.notes?.trim() ?? "");
        const issued = todayIso(timeZone);
        setInvoiceDate(issued);
        setDueDate(q.validUntil?.trim() || addDaysIso(issued, 14));
      }

      if (loadedDraftInvoice) {
        setCustomerName(loadedDraftInvoice.customer.fullName);
        setCustomerEmail(loadedDraftInvoice.customer.email);
        setCustomerPhone(loadedDraftInvoice.customer.phone);
        setCustomerSearch(loadedDraftInvoice.customer.fullName);
        setAddress(loadedDraftInvoice.address);
        setLineItems(loadedDraftInvoice.lineItems.map(quotationLineToSaved));
        setDiscount(
          loadedDraftInvoice.discountAud > 0
            ? {
                mode: "fixed",
                percent: 0,
                amountAud: loadedDraftInvoice.discountAud,
              }
            : null,
        );
        if (loadedDraftInvoice.depositRequest) {
          setDeposit({
            mode: loadedDraftInvoice.depositRequest.mode,
            percent: loadedDraftInvoice.depositRequest.percent,
            amountAud: loadedDraftInvoice.depositRequest.amountAud,
            dueDate: loadedDraftInvoice.depositRequest.dueDate,
          });
          setDepositPaid(loadedDraftInvoice.depositRequest.paid === true);
        } else {
          setDeposit(null);
          setDepositPaid(false);
        }
        const rawTerms = loadedDraftInvoice.termsAndConditions?.trim() || "";
        if (loadedDraftInvoice.depositRequest) {
          const depositNote = formatDepositPaymentNote(
            loadedDraftInvoice.depositRequest,
          );
          setTermsAndConditions(
            rawTerms.replace(depositNote, "").replace(/\n{3,}/g, "\n\n").trim(),
          );
        } else {
          setTermsAndConditions(rawTerms);
        }
        setNotes(loadedDraftInvoice.notes?.trim() ?? "");
        setInvoiceDate(loadedDraftInvoice.invoiceDate || todayIso(timeZone));
        setDueDate(
          loadedDraftInvoice.dueDate ||
            addDaysIso(loadedDraftInvoice.invoiceDate || todayIso(timeZone), 14),
        );
        setRequestType("custom_quote");
        setCustomServiceTitle(loadedDraftInvoice.serviceTitle);
      }

      const itemsBody = (await itemsRes.json()) as {
        ok?: boolean;
        items?: CatalogItem[];
      };
      if (itemsRes.ok && itemsBody.ok && itemsBody.items) {
        setCatalog(
          itemsBody.items.map((item) => ({
            ...item,
            code: item.code ?? null,
            description: item.description ?? null,
          })),
        );
      }

      if (profileRes.ok) {
        const profileBody = (await profileRes.json()) as {
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
        const profile = profileBody.profile;
        if (profile) {
          setGstEnabled(Boolean(profile.registeredForGst));
          if (profile.gstPercentage != null) {
            setGstPercentage(profile.gstPercentage);
          }
          setBusinessAddress(profile.businessAddress ?? null);
          setBusinessEmail(profile.businessEmail ?? null);
          setBusinessPhone(profile.businessPhone ?? null);
          setBusinessAbn(profile.abn ?? null);
          if (direct && profile.termsAndConditions?.trim()) {
            setTermsAndConditions(profile.termsAndConditions.trim());
          }
        }
      }

      if ((direct || isEditingDraftInvoice) && servicesRes) {
        setServicesLoading(true);
        const servicesData = (await servicesRes.json()) as {
          ok?: boolean;
          services?: BusinessServiceDetail[];
        };
        if (servicesRes.ok && servicesData.ok && servicesData.services) {
          setServices(servicesData.services);
        }
        setServicesLoading(false);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load quotation.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    quotationId,
    draftInvoiceId,
    direct,
    isEditingDraftInvoice,
    user,
    timeZone,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadQuotation();
    });
    return () => cancelAnimationFrame(frame);
  }, [loadQuotation]);

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
  const isDirectDraftInvoice =
    isEditingDraftInvoice && quotation?.createdSource === "invoice_direct";
  const directMode = direct || isDirectDraftInvoice;

  const customerOptions = useMemo(
    () => buildCustomerOptions(requests),
    [requests],
  );

  const filteredCustomers = useMemo(
    () => filterCustomerOptions(customerOptions, customerSearch),
    [customerOptions, customerSearch],
  );

  function selectCustomer(option: CustomerOption) {
    setCustomerName(option.fullName);
    setCustomerEmail(option.email);
    setCustomerPhone(option.phone);
    if (option.address && directMode) {
      setAddress({ ...option.address });
    }
    setCustomerSearch(option.fullName);
    setShowCustomerDropdown(false);
    setError(null);
  }

  const directServiceTitle = useMemo(() => {
    if (!directMode) return "";
    if (requestType === "existing_service") {
      return selectedService?.name ?? "";
    }
    return customServiceTitle.trim();
  }, [directMode, requestType, selectedService, customServiceTitle]);

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

  const documentLineItems = useMemo((): QuotationDocumentLineItem[] => {
    return lineItems.map((item) => {
      const gstPercent = lineGstPercent(item.applyGst, gstEnabled, gstPercentage);
      const { amountAud, listRateAudExGst } = computeQuotationLineAmounts({
        quantity: item.quantity,
        rate: item.rate,
        discountPercent: item.discountPercent,
        gstPercent,
        gstPricing,
      });
      return {
        code: item.code.trim() || null,
        name: item.name.trim() || "Line item",
        description: item.description.trim() || null,
        quantity: item.quantity,
        rateAud: listRateAudExGst,
        discountPercent: item.discountPercent,
        gstPercent,
        amountAud,
      };
    });
  }, [lineItems, gstEnabled, gstPercentage, gstPricing]);

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

  const subtotalRaw = useMemo(
    () => documentLineItems.reduce((sum, item) => sum + item.amountAud, 0),
    [documentLineItems],
  );

  const discountAud = useMemo(() => {
    if (!discount) return 0;
    const amount =
      discount.mode === "percent"
        ? (subtotalRaw * discount.percent) / 100
        : discount.amountAud;
    return Math.round(Math.min(Math.max(0, amount), subtotalRaw) * 100) / 100;
  }, [discount, subtotalRaw]);

  const { subtotalAud, gstAud, totalAud } = useMemo(
    () =>
      computeDocumentTotals({
        lineItems: documentLineItems,
        discountAud,
      }),
    [documentLineItems, discountAud],
  );

  const documentDeposit = useMemo(
    () =>
      buildQuotationDocumentDeposit(
        totalAud,
        deposit ? { ...deposit, paid: depositPaid } : null,
      ),
    [totalAud, deposit, depositPaid],
  );

  // Only a received deposit reduces what the customer owes; an unpaid
  // deposit means the invoice is issued for the full amount.
  const balanceDueAud =
    documentDeposit && documentDeposit.paid
      ? documentDeposit.balanceDueAud
      : totalAud;

  const invoiceCode = useMemo(() => {
    if (draftInvoice?.invoiceCode) return draftInvoice.invoiceCode;
    if (!quotation) return "Draft";
    return buildInvoiceCodeForQuotation(quotation);
  }, [draftInvoice, quotation]);

  const previewDocument = useMemo((): QuotationDocumentData => {
    return {
      quoteNo: invoiceCode,
      quoteDate: formatQuoteDate(invoiceDate),
      validUntil: dueDate,
      serviceTitle:
        quotation?.serviceTitle ?? (directServiceTitle || null),
      customer: {
        fullName: customerName.trim(),
        email: customerEmail.trim(),
        phone: customerPhone.trim(),
      },
      customerAddress: address,
      lineItems: documentLineItems,
      subtotalAud,
      discountAud,
      gstAud,
      totalAud,
      deposit: documentDeposit,
      termsAndConditions: (() => {
        const base = termsAndConditions.trim() || null;
        if (!documentDeposit) return base;
        const depositNote = formatDepositPaymentNote(documentDeposit);
        if (base?.includes(depositNote)) return base;
        return base ? `${base}\n\n${depositNote}` : depositNote;
      })(),
      paymentInstructions: null,
      notes: notes.trim() || null,
      business: {
        businessName: business?.businessName ?? "Your business",
        logoUrl: business?.logoUrl ?? null,
        address: businessAddress,
        email: businessEmail,
        phone: businessPhone,
        abn: businessAbn,
        registeredForGst: gstEnabled,
        gstPercentage: gstEnabled ? gstPercentage : 0,
      },
    };
  }, [
    invoiceCode,
    invoiceDate,
    dueDate,
    quotation?.serviceTitle,
    directServiceTitle,
    customerName,
    customerEmail,
    customerPhone,
    address,
    documentLineItems,
    subtotalAud,
    discountAud,
    gstAud,
    totalAud,
    documentDeposit,
    termsAndConditions,
    notes,
    business,
    businessAddress,
    businessEmail,
    businessPhone,
    businessAbn,
    gstEnabled,
    gstPercentage,
  ]);

  async function saveInvoice(andSend = false) {
    if (!user || (!direct && !quotation)) return;
    if (lineItems.length === 0) {
      setError("Add at least one line item.");
      setTab("create");
      return;
    }
    if (directMode) {
      if (requestType === "existing_service") {
        if (!selectedServiceId) {
          setError("Select a service from your catalog.");
          setTab("create");
          return;
        }
      } else if (customServiceTitle.trim().length < 3) {
        setError("Add a job title (at least 3 characters).");
        setTab("create");
        return;
      }
      if (customerName.trim().length < 2) {
        setError("Add the customer's name.");
        setTab("create");
        return;
      }
      if (!customerEmail.trim() || !customerEmail.includes("@")) {
        setError("Enter a valid customer email address.");
        setTab("create");
        return;
      }
      if (customerPhone.replace(/\D/g, "").length < 6) {
        setError("Enter a valid customer mobile number.");
        setTab("create");
        return;
      }
    }
    if (andSend && !customerEmail.trim()) {
      setError("Add a customer email before sending.");
      setTab("send");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const directPayload = {
        serviceTitle: directServiceTitle,
        description:
          requestType === "custom_quote"
            ? customServiceDescription.trim() || null
            : null,
        requestType,
        serviceId: requestType === "existing_service" ? selectedServiceId : null,
        customRequest:
          requestType === "custom_quote"
            ? {
                title: customServiceTitle.trim(),
                description: customServiceDescription.trim(),
              }
            : null,
        customer: {
          fullName: customerName.trim(),
          email: customerEmail.trim(),
          phone: customerPhone.trim(),
        },
        address,
      };
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...(direct && !isEditingDraftInvoice
            ? {
                direct: true,
                ...directPayload,
              }
            : {
                quotationId: quotation!.id,
                ...(isDirectDraftInvoice ? directPayload : {}),
              }),
          lineItems: toApiLineItems(
            lineItems,
            gstEnabled,
            gstPercentage,
            gstPricing,
          ),
          finalPriceAud: totalAud,
          discountAud,
          gstAud,
          depositRequest: documentDeposit
            ? {
                mode: documentDeposit.mode,
                percent: documentDeposit.percent,
                amountAud: documentDeposit.amountAud,
                dueDate: documentDeposit.dueDate,
                paid: documentDeposit.paid,
              }
            : null,
          notes: notes.trim() || null,
          termsAndConditions: termsAndConditions.trim() || null,
          invoiceDate,
          dueDate,
          send: andSend,
        }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Could not save invoice.");
      }
      router.push("/dashboard/invoices");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save invoice.",
      );
    } finally {
      setSubmitting(false);
    }
  }

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
    const description = (itemDraft.description ?? "").trim();
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
      description,
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
            description: description || null,
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

  function openPriceEditor() {
    setTab("create");
    const [firstItem] = lineItems;
    if (!firstItem) {
      startAddItem();
      return;
    }
    if (lineItems.length === 1) {
      startEditItem(firstItem);
    }
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

  if (loading) {
    return (
      <div className="space-y-3 px-4 py-6 sm:px-6">
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            className="h-20 animate-pulse rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
          />
        ))}
      </div>
    );
  }

  if (!direct && !quotation) {
    return (
      <div className="px-4 py-10 text-center sm:px-6">
        <p className="font-body text-[14px] text-on-surface-variant">
          {error ?? "Quotation not found."}
        </p>
        <Link
          href="/dashboard/quotations"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-body text-[14px] font-semibold text-on-primary"
        >
          Back to quotations
        </Link>
      </div>
    );
  }

  const quotationCode = quotation ? displayQuotationCode(quotation) : null;
  const businessName = business?.businessName ?? "Your business";
  const sendMessage = documentDeposit
    ? documentDeposit.paid
      ? `Thank you for your business. Please find your invoice details below.\n\nTotal: ${formatAud(totalAud)}\nDeposit received: ${formatAud(documentDeposit.amountAud)}\nBalance due: ${formatAud(balanceDueAud)}`
      : `Thank you for your business. Please find your invoice details below.\n\nTotal due: ${formatAud(totalAud)}\nDeposit: ${formatAud(documentDeposit.amountAud)} due by ${formatQuoteDate(documentDeposit.dueDate)}`
    : `Thank you for your business. Please find your invoice details below.\n\nTotal due: ${formatAud(totalAud)}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-outline-variant/60 bg-background/95 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={
                direct || isEditingDraftInvoice
                  ? "/dashboard/invoices"
                  : "/dashboard/quotations"
              }
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
              aria-label={
                direct || isEditingDraftInvoice
                  ? "Back to invoices"
                  : "Back to quotations"
              }
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[18px] font-semibold text-on-surface sm:text-[20px]">
                {isEditingDraftInvoice
                  ? "Edit draft invoice"
                  : direct
                    ? "Create invoice"
                    : "Issue invoice"}
              </h1>
              <p className="truncate font-body text-[12px] text-on-surface-variant">
                {quotation
                  ? `From ${quotationCode} · ${quotation.serviceTitle}`
                  : "Direct invoice · saved as a completed job"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void saveInvoice()}
            disabled={submitting}
            className="inline-flex min-w-[6.5rem] items-center justify-center rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting
              ? "Saving…"
              : isEditingDraftInvoice
                ? "Update draft"
                : "Save draft"}
          </button>
        </div>

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

      {error ? (
        <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container sm:mx-6">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        {tab === "create" ? (
          <div className="mx-auto max-w-2xl space-y-4">
              {directMode ? (
                <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                  <h2 className="font-body text-[15px] font-semibold text-on-surface">
                    Job details
                  </h2>
                  <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                    Describe the work for this invoice.
                  </p>

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
                      <span className={LABEL_CLASS}>Description</span>
                      <textarea
                        value={customServiceDescription}
                        onChange={(e) => {
                          setCustomServiceDescription(e.target.value);
                          setError(null);
                        }}
                        rows={4}
                        placeholder="Scope of work, access notes, materials…"
                        className={`${INPUT_CLASS} resize-y`}
                        maxLength={2000}
                      />
                    </label>
                  </div>

                  <p className="mt-3 font-body text-[12px] text-on-surface-variant">
                    A completed request, quotation, and job are saved with this
                    invoice so it appears alongside your other finished work.
                  </p>
                </section>
              ) : null}

              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Customer
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="relative sm:col-span-2">
                    <label className="block">
                      <span className={LABEL_CLASS}>Name</span>
                      <input
                        type="text"
                        value={customerSearch || customerName}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setCustomerName(e.target.value);
                          setShowCustomerDropdown(true);
                          setError(null);
                        }}
                        onFocus={() => setShowCustomerDropdown(true)}
                        onBlur={() => {
                          window.setTimeout(
                            () => setShowCustomerDropdown(false),
                            150,
                          );
                        }}
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
                              onMouseDown={(e) => e.preventDefault()}
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
                  <label className="block">
                    <span className={LABEL_CLASS}>Email</span>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block">
                    <span className={LABEL_CLASS}>Phone</span>
                    <AuPhoneInput
                      value={customerPhone}
                      onChange={setCustomerPhone}
                      className="mt-1"
                    />
                  </label>
                  {directMode ? (
                    <>
                      <label className="block sm:col-span-2">
                        <span className={LABEL_CLASS}>
                          Street address (optional)
                        </span>
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
                      <div className="grid grid-cols-2 gap-3">
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
                        <label className="block">
                          <span className={LABEL_CLASS}>Postcode</span>
                          <input
                            type="text"
                            value={address.postcode}
                            onChange={(e) =>
                              setAddress((prev) => ({
                                ...prev,
                                postcode: e.target.value,
                              }))
                            }
                            className={INPUT_CLASS}
                          />
                        </label>
                      </div>
                    </>
                  ) : (
                    <p className="font-body text-[13px] text-on-surface-variant sm:col-span-2">
                      {formatAddress(address) || "No address on quotation"}
                    </p>
                  )}
                </div>
              </section>

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
                            onClick={() => startEditItem(item)}
                            className="rounded-full border border-primary/25 px-2.5 py-1 font-body text-[11px] font-semibold text-primary hover:bg-primary/5"
                          >
                            Edit price
                          </button>
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
                          computeSavedLineAmount(
                            {
                              quantity: parseNum(itemDraft.quantity) || 1,
                              rate: parseNum(itemDraft.rate),
                              discountPercent: Math.min(
                                100,
                                parseNum(itemDraft.discountPercent),
                              ),
                              applyGst: itemDraft.applyGst,
                            },
                            gstEnabled,
                            gstPercentage,
                            gstPricing,
                          ),
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

              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Notes & terms
                </h2>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className={LABEL_CLASS}>Terms and conditions</span>
                    <textarea
                      rows={4}
                      value={termsAndConditions}
                      onChange={(e) => setTermsAndConditions(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </label>
                  <label className="block">
                    <span className={LABEL_CLASS}>Comments</span>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </label>
                </div>
              </section>
          </div>
        ) : tab === "preview" ? (
          <div className="mx-auto max-w-[760px] space-y-3 pb-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-body text-[12px] text-on-surface-variant">
                This preview matches the invoice your customer will receive.
              </p>
              <button
                type="button"
                onClick={() => printDocumentPreview()}
                className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/60 bg-surface-container-lowest px-3 py-2 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-[18px]">print</span>
                Print
              </button>
            </div>
            <QuotationDocumentPreview
              document={previewDocument}
              kind="invoice"
            />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
              <label className="block">
                <span className={LABEL_CLASS}>To</span>
                <input
                  type="email"
                  readOnly
                  value={customerEmail}
                  className={`${INPUT_CLASS} bg-surface-container-low`}
                />
              </label>
              <label className="mt-3 block">
                <span className={LABEL_CLASS}>Subject</span>
                <input
                  type="text"
                  readOnly
                  value={`Invoice from ${businessName}`}
                  className={`${INPUT_CLASS} bg-surface-container-low`}
                />
              </label>
              <label className="mt-3 block">
                <span className={LABEL_CLASS}>Message</span>
                <textarea
                  readOnly
                  rows={5}
                  value={sendMessage}
                  className={`${INPUT_CLASS} resize-none bg-surface-container-low`}
                />
              </label>
            </div>
            <p className="rounded-lg border border-dashed border-outline-variant/60 bg-surface-container/50 px-3 py-2.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
              Use <strong>Save draft</strong> to keep an unsent invoice. The
              invoice PDF is emailed to the client only when you click{" "}
              <strong>Save &amp; send invoice</strong> below. Use the Preview tab
              to check the document before sending. The linked job is marked
              completed when the invoice is saved.
            </p>
            <button
              type="button"
              onClick={() => void saveInvoice(true)}
              disabled={submitting || !customerEmail.trim()}
              className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50 sm:max-w-xs"
            >
              {submitting ? (
                <SaveSpinner label="Sending…" />
              ) : (
                "Save & send invoice"
              )}
            </button>
          </div>
        )}
        </div>

        {/* Summary sidebar — visible on Create, Preview, and Send */}
        <aside className="shrink-0 border-t border-outline-variant/60 bg-gradient-to-b from-[#edf4ff]/30 to-surface-container-low px-3 py-3 lg:w-[23rem] lg:border-l lg:border-t-0 lg:px-4 lg:py-4 xl:w-[26rem]">
          <div className="space-y-3">
            <div className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest p-3 shadow-sm">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <p className="font-body text-[12px] font-bold text-on-surface">
                  Draft invoice
                </p>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 font-body text-[9px] font-bold uppercase tracking-wide text-amber-700">
                  <span className="h-1 w-1 rounded-full bg-amber-500" />
                  Unsent
                </span>
              </div>
              <p className="font-mono text-[13px] font-semibold text-primary">
                {invoiceCode}
              </p>
              <div className="mt-3 space-y-2.5">
                <MonthCalendarField
                  label="Invoice date"
                  selectedIso={invoiceDate}
                  minDate="2020-01-01"
                  onSelect={setInvoiceDate}
                />
                <MonthCalendarField
                  label="Due date"
                  selectedIso={dueDate}
                  minDate={invoiceDate}
                  onSelect={setDueDate}
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container-lowest shadow-sm">
              <div className="space-y-1.5 px-3 py-2.5 font-body text-[12px]">
                <div className="flex justify-between text-on-surface-variant">
                  <span>Subtotal</span>
                  <span className="font-numeric font-medium text-on-surface">
                    {formatAud(subtotalAud)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDiscountModalOpen(true)}
                  className="flex w-full items-center justify-between text-primary"
                >
                  <span className="font-semibold">
                    {discountAud > 0 ? "Discount" : "Add discount"}
                  </span>
                  <span className="font-numeric font-medium text-on-surface">
                    {discountAud > 0 ? `−${formatAud(discountAud)}` : ""}
                  </span>
                </button>
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
                            ? "GST is included in invoice totals"
                            : "Tap to add GST to this invoice"}
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
                {gstAud > 0 ? (
                  <div className="flex justify-between text-on-surface-variant">
                    <span>GST ({gstPercentage}%)</span>
                    <span className="font-numeric font-medium text-on-surface">
                      {formatAud(gstAud)}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between border-t border-outline-variant/40 bg-[#1a1f28] px-3 py-2.5">
                <span className="font-body text-[13px] font-bold text-white">
                  Total
                </span>
                <span className="font-numeric text-[15px] font-bold text-white">
                  {formatAud(totalAud)}
                </span>
              </div>
              <div className="border-t border-outline-variant/30 px-3 py-2.5">
                <button
                  type="button"
                  onClick={openPriceEditor}
                  className="flex w-full items-center justify-between gap-3 text-left font-body text-[13px] font-semibold text-primary hover:text-primary/80"
                >
                  <span>Edit price</span>
                  <span className="font-body text-[11px] font-medium text-on-surface-variant">
                    {lineItems.length === 0
                      ? "Add item"
                      : lineItems.length === 1
                        ? "Update item rate"
                        : "Edit items"}
                  </span>
                </button>
              </div>
              {documentDeposit ? (
                <>
                  <div className="space-y-1.5 border-t border-outline-variant/40 px-3 py-2.5 font-body text-[12px]">
                    <div className="flex justify-between text-on-surface-variant">
                      <span>
                        {documentDeposit.paid
                          ? "Deposit paid"
                          : "Deposit not paid"}
                      </span>
                      <span
                        className={`font-numeric font-medium ${
                          documentDeposit.paid
                            ? "text-emerald-600"
                            : "text-on-surface"
                        }`}
                      >
                        {documentDeposit.paid
                          ? `−${formatAud(documentDeposit.amountAud)}`
                          : formatAud(documentDeposit.amountAud)}
                      </span>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[10px] text-on-surface-variant">
                        {formatDepositPaymentNote(documentDeposit)}
                      </p>
                      <button
                        type="button"
                        onClick={() => setDepositModalOpen(true)}
                        className="shrink-0 rounded-full border border-primary/25 px-3 py-1.5 font-body text-[13px] font-semibold text-primary hover:bg-primary/5"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] font-semibold text-on-surface-variant">
                        Payment status
                      </span>
                      <div className="flex overflow-hidden rounded-full border border-outline-variant/60">
                        <button
                          type="button"
                          onClick={() => setDepositPaid(false)}
                          className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            !depositPaid
                              ? "bg-primary text-on-primary"
                              : "bg-transparent text-on-surface-variant hover:bg-surface-container-low"
                          }`}
                        >
                          Not paid
                        </button>
                        <button
                          type="button"
                          onClick={() => setDepositPaid(true)}
                          className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            depositPaid
                              ? "bg-emerald-600 text-white"
                              : "bg-transparent text-on-surface-variant hover:bg-surface-container-low"
                          }`}
                        >
                          Paid
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-primary px-3 py-2.5">
                    <span className="font-body text-[13px] font-bold text-on-primary">
                      Balance due
                    </span>
                    <span className="font-numeric text-[15px] font-bold text-on-primary">
                      {formatAud(balanceDueAud)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="border-t border-outline-variant/30 px-3 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => setDepositModalOpen(true)}
                    className="font-body text-[13px] font-semibold text-primary underline underline-offset-2 hover:text-primary/80"
                  >
                    Record payment
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
              <p className="font-body text-[11px] leading-relaxed text-on-surface-variant">
                Issuing this invoice marks the linked job as{" "}
                <span className="font-semibold text-on-surface">completed</span>.
              </p>
            </div>
          </div>
        </aside>
      </div>

      <DiscountEditModal
        open={discountModalOpen}
        subtotalAud={subtotalRaw}
        initial={discount}
        onClose={() => setDiscountModalOpen(false)}
        onSave={(next) => setDiscount(next)}
      />
      <DepositRequestModal
        open={depositModalOpen}
        quotationTotalAud={totalAud}
        initial={deposit}
        defaultDueDate={dueDate}
        minDueDate={invoiceDate}
        onClose={() => setDepositModalOpen(false)}
        title="Record payment"
        totalLabel="Invoice total"
        amountLabel="Payment amount"
        saveLabel="Save payment"
        removeLabel="Remove payment"
        onSave={(next) => {
          const hadDeposit = Boolean(deposit);
          setDeposit(next);
          if (!next) {
            setDepositPaid(false);
          } else if (!hadDeposit) {
            setDepositPaid(true);
          }
        }}
      />
    </div>
  );
}
