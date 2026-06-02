"use client";

import { QuotationDocumentPreview } from "@/components/quotation-document-preview";
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
  type GstPricingMode,
  type QuotationDocumentData,
} from "@/lib/quotations/document";
import {
  type InspectionAddress,
  type InspectionRequestDetail,
} from "@/lib/inspection/types";
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

type CatalogItem = { id: string; name: string; code: string | null; priceAud: number };

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

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatAud(value: number): string {
  return `Aus $${value.toFixed(2)}`;
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

export function CreateQuotationPage() {
  const router = useRouter();
  const { user } = useAuth();
  const business = useBusinessProfile();
  const { requests } = useInspectionRequests();

  const [tab, setTab] = useState<Tab>("create");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientOpen, setClientOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [customer, setCustomer] = useState({
    fullName: "",
    email: "",
    phone: "",
  });
  const [address, setAddress] = useState<InspectionAddress>({
    ...EMPTY_ADDRESS,
  });

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [lineItems, setLineItems] = useState<SavedLineItem[]>([]);
  const [itemDraft, setItemDraft] = useState<DraftLineItem | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const [quotationDate, setQuotationDate] = useState(todayIso());
  const [terms, setTerms] = useState<TermsId>("same_day");
  const [discountAud, setDiscountAud] = useState("");
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

  const dueDate = useMemo(() => {
    const opt = TERMS_OPTIONS.find((t) => t.id === terms);
    return addDaysIso(quotationDate, opt?.days ?? 0);
  }, [quotationDate, terms]);

  const minQuotationDate = useMemo(() => addDaysIso(todayIso(), -730), []);

  const discountAmount = parseNum(discountAud);

  useEffect(() => {
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

  const documentTotals = useMemo(
    () =>
      computeDocumentTotals({
        lineItems: documentLineItems,
        discountAud: discountAmount,
      }),
    [documentLineItems, discountAmount],
  );

  const subtotal = documentTotals.subtotalAud;
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
      setDepositRequest((prev) =>
        prev ? { ...prev, amountAud: capped } : prev,
      );
    }
  }, [total, depositRequest]);

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
        const [itemsRes, profileRes] = await Promise.all([
          fetch("/api/items", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/business/profile", {
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
        }
      } catch {
        /* optional */
      }
    })();
  }, [user]);

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
          }),
        });
        await refreshCatalog(token);
      } catch {
        /* catalog save is best-effort */
      }
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
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
        throw new Error(data.error ?? "Could not upload image.");
      }
      setImageUrls((prev) => [...prev, data.imageUrl!].slice(0, 10));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload image.",
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
    if (lineItems.length === 0) return "Add at least one line item.";
    return null;
  }, [customer, address, lineItems]);

  async function save() {
    if (!user) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setTab("create");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const title =
        lineItems[0]?.name.trim() ||
        (lineItems.length > 1 ? "Quotation" : "Custom quotation");
      const response = await fetch("/api/quotations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          standalone: true,
          customer: {
            fullName: customer.fullName.trim(),
            email: customer.email.trim().toLowerCase(),
            phone: customer.phone,
          },
          address,
          title,
          description: lineItems
            .map((item) =>
              item.description
                ? `${item.name} — ${item.description}`
                : item.name,
            )
            .join("; "),
          lineItems: lineItems.map((item) => ({
            code: (item.code ?? "").trim() || null,
            name: item.name,
            description: item.description || null,
            quantity: item.quantity,
            rateAud: item.rate,
            gstPercent: lineGstPercent(
              item.applyGst,
              gstEnabled,
              gstPercentage,
            ),
            priceAud: item.amountAud,
          })),
          finalPriceAud: total,
          discountAud: discountAmount,
          notes: comment.trim() || null,
          paymentInstructions: paymentInstructions.trim() || null,
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
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
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
      paymentInstructions: paymentInstructions.trim() || null,
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
    customer,
    address,
    documentLineItems,
    subtotal,
    discountAmount,
    gstAmount,
    total,
    paymentInstructions,
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
              Create a quotation
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
              onClick={() => void save()}
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save"}
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
              {/* Client */}
              {!clientOpen ? (
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
                      <input
                        type="tel"
                        value={customer.phone}
                        onChange={(e) =>
                          setCustomer((prev) => ({
                            ...prev,
                            phone: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        className={INPUT_CLASS}
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
                    <datalist id="quotation-item-catalog">
                      {catalog.map((item) => (
                        <option key={item.id} value={item.name} />
                      ))}
                    </datalist>
                    <label className="block">
                      <span className={LABEL_CLASS}>Item code</span>
                      <input
                        type="text"
                        value={itemDraft.code ?? ""}
                        onChange={(e) =>
                          setItemDraft((prev) =>
                            prev ? { ...prev, code: e.target.value } : prev,
                          )
                        }
                        placeholder="e.g. TAP-001"
                        className={INPUT_CLASS}
                        autoFocus
                      />
                    </label>
                    <label className="mt-3 block">
                      <span className={LABEL_CLASS}>Item name</span>
                      <input
                        type="text"
                        list="quotation-item-catalog"
                        value={itemDraft.name ?? ""}
                        onChange={(e) => {
                          const name = e.target.value;
                          const match = catalog.find(
                            (c) =>
                              c.name.toLowerCase() === name.trim().toLowerCase(),
                          );
                          setItemDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  name,
                                  code: match ? (match.code ?? "") : (prev.code ?? ""),
                                  rate: match
                                    ? String(match.priceAud)
                                    : prev.rate,
                                }
                              : prev,
                          );
                        }}
                        className={INPUT_CLASS}
                      />
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void uploadImage(e)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage || imageUrls.length >= 10}
                  className="mt-3 inline-flex items-center gap-2 font-body text-[14px] font-semibold text-primary disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    photo_camera
                  </span>
                  {uploadingImage ? "Uploading…" : "Add photos"}
                </button>
                {imageUrls.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {imageUrls.map((url, index) => (
                      <li key={url} className="relative">
                        <img
                          src={url}
                          alt=""
                          className="h-16 w-16 rounded-lg border border-outline-variant/60 object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setImageUrls((prev) =>
                              prev.filter((_, idx) => idx !== index),
                            )
                          }
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-on-surface text-surface"
                          aria-label="Remove photo"
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

              {/* Comments & payment */}
              <section className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4">
                <h2 className="font-body text-[15px] font-semibold text-on-surface">
                  Comments and payment instructions
                </h2>
                <div className="mt-3 flex flex-wrap gap-4">
                  {!commentOpen ? (
                    <button
                      type="button"
                      onClick={() => setCommentOpen(true)}
                      className="font-body text-[14px] font-semibold text-primary"
                    >
                      Add comment
                    </button>
                  ) : null}
                  {!paymentOpen ? (
                    <button
                      type="button"
                      onClick={() => setPaymentOpen(true)}
                      className="font-body text-[14px] font-semibold text-primary"
                    >
                      Add payment instructions
                    </button>
                  ) : null}
                </div>
                {commentOpen ? (
                  <label className="mt-3 block">
                    <span className={LABEL_CLASS}>Comment</span>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      className={`${INPUT_CLASS} resize-y`}
                      maxLength={2000}
                    />
                  </label>
                ) : null}
                {paymentOpen ? (
                  <label className="mt-3 block">
                    <span className={LABEL_CLASS}>Payment instructions</span>
                    <textarea
                      value={paymentInstructions}
                      onChange={(e) => setPaymentInstructions(e.target.value)}
                      rows={3}
                      placeholder="Bank details, payment terms, etc."
                      className={`${INPUT_CLASS} resize-y`}
                      maxLength={2000}
                    />
                  </label>
                ) : null}
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
                The quotation PDF is emailed to the client when you click{" "}
                <strong>Save</strong>. Use the Preview tab to check the document
                before sending.
              </p>
              <button
                type="button"
                onClick={() => void save()}
                disabled={submitting || !customer.email.trim()}
                className="w-full rounded-xl bg-primary px-4 py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50 sm:max-w-xs"
              >
                {submitting ? "Sending…" : "Save & send quotation"}
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
                  <span className="text-on-surface-variant">Discount</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-body text-[11px] text-on-surface-variant">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={discountAud}
                      onChange={(e) => setDiscountAud(e.target.value)}
                      placeholder="0.00"
                      className={`${NUMBER_INPUT_CLASS} mt-0 w-[6.5rem] py-1.5 pl-5 pr-2 text-right text-[13px]`}
                    />
                  </div>
                </div>
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
                  className="font-body text-[13px] font-semibold text-primary hover:underline"
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
