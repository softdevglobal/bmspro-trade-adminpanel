"use client";

import { formatTenantDate } from "@/lib/onboarding/tenant-display";
import type {
  TenantPackagePurchaseEntry,
  TenantPackageUsageCatalog,
  TenantPackageUsageEntry,
} from "@/lib/catalog/tenant-package-usage-types";
import { useEffect, useMemo, useState } from "react";

const TENANT_USAGE_PAGE_SIZE = 5;

function matchesUsageSearch(
  row: TenantPackageUsageEntry,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.tenantName,
    row.businessName,
    row.ownerName,
    row.ownerEmail,
    row.planName,
    row.planPriceLabel,
    row.smsPackageName,
    row.billingStatus,
  ];
  return haystack.some(
    (value) => typeof value === "string" && value.toLowerCase().includes(q),
  );
}

function matchesPurchaseSearch(
  row: TenantPackagePurchaseEntry,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.tenantName,
    row.businessName,
    row.ownerName,
    row.ownerEmail,
    row.planName,
    row.planId,
    row.planPriceLabel,
    row.smsPackageName,
    row.smsPackageId,
    row.type === "subscription" ? "subscription" : "sms top-up",
  ];
  return haystack.some(
    (value) => typeof value === "string" && value.toLowerCase().includes(q),
  );
}

function paginateRows<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = rows.length === 0 ? 0 : (safePage - 1) * pageSize;
  const pageEnd = Math.min(safePage * pageSize, rows.length);
  return {
    rows: rows.slice(pageStart, pageEnd),
    totalPages,
    safePage,
    pageStart,
    pageEnd,
    totalItems: rows.length,
  };
}

function formatSmsBalance(row: TenantPackageUsageEntry): string {
  if (row.smsLimit < 0) return "Unlimited";
  const remaining = row.smsRemaining ?? Math.max(0, row.smsLimit - row.smsUsed);
  return `${remaining} / ${row.smsLimit}`;
}

function TenantCell({
  tenantName,
  ownerName,
  ownerEmail,
}: {
  tenantName: string;
  ownerName: string | null;
  ownerEmail: string | null;
}) {
  return (
    <div>
      <p className="font-semibold text-on-surface">{tenantName}</p>
      {ownerName ? (
        <p className="mt-0.5 text-[11px] text-on-surface-variant">
          <span className="font-medium text-on-surface">Owner: </span>
          {ownerName}
        </p>
      ) : null}
      {ownerEmail ? (
        <p className="text-[11px] text-on-surface-variant">{ownerEmail}</p>
      ) : null}
    </div>
  );
}

function UsageTable({
  rows,
  focus,
  variant = "admin",
}: {
  rows: TenantPackageUsageEntry[];
  focus: "subscription" | "sms";
  variant?: "admin" | "tenant";
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
        {variant === "tenant"
          ? "No SMS package is assigned to your workshop yet."
          : "No tenants are using packages in this view yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left font-body text-[12px]">
        <thead className="border-b border-outline-variant bg-surface-container-lowest">
          <tr>
            {variant === "admin" ? (
              <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                Tenant name
              </th>
            ) : null}
            {focus === "subscription" ? (
              <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                Subscription plan
              </th>
            ) : null}
            <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
              SMS package
            </th>
            <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
              SMS balance
            </th>
            <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
              SMS source
            </th>
            {focus === "subscription" ? (
              <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                Billing
              </th>
            ) : null}
            <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
              Renews
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/60">
          {rows.map((row) => (
            <tr key={row.businessId} className="hover:bg-surface-container-lowest/80">
              {variant === "admin" ? (
                <td className="px-3 py-2.5">
                  <TenantCell
                    tenantName={row.tenantName ?? row.businessName}
                    ownerName={row.ownerName}
                    ownerEmail={row.ownerEmail}
                  />
                </td>
              ) : null}
              {focus === "subscription" ? (
                <td className="px-3 py-2.5 text-on-surface">
                  <div>{row.planName ?? "—"}</div>
                  {row.planPriceLabel ? (
                    <div className="text-[11px] text-on-surface-variant">
                      {row.planPriceLabel}
                    </div>
                  ) : null}
                </td>
              ) : null}
              <td className="px-3 py-2.5 text-on-surface">
                {row.smsPackageName ?? "—"}
              </td>
              <td className="px-3 py-2.5 tabular-nums text-on-surface-variant">
                {formatSmsBalance(row)}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    row.smsBundled
                      ? "bg-teal-100 text-teal-800"
                      : "bg-sky-100 text-sky-800"
                  }`}
                >
                  {row.smsBundled ? "Bundled" : "Top-up / assigned"}
                </span>
              </td>
              {focus === "subscription" ? (
                <td className="px-3 py-2.5 capitalize text-on-surface-variant">
                  {row.billingStatus?.replace(/_/g, " ") ?? "—"}
                </td>
              ) : null}
              <td className="px-3 py-2.5 text-on-surface-variant">
                {formatTenantDate(row.subscriptionPeriodEnd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PurchaseTable({
  rows,
  focus,
  variant = "admin",
}: {
  rows: TenantPackagePurchaseEntry[];
  focus: "subscription" | "sms";
  variant?: "admin" | "tenant";
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-outline-variant px-4 py-6 text-center font-body text-[12px] text-on-surface-variant">
        No Stripe purchases recorded yet for this category.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left font-body text-[12px]">
        <thead className="border-b border-outline-variant bg-surface-container-lowest">
          <tr>
            <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
              When
            </th>
            {variant === "admin" ? (
              <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                Tenant name
              </th>
            ) : null}
            <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
              Type
            </th>
            {focus === "subscription" ? (
              <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                Plan purchased
              </th>
            ) : (
              <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                SMS package purchased
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/60">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-surface-container-lowest/80">
              <td className="px-3 py-2.5 text-on-surface-variant">
                {formatTenantDate(row.fulfilledAt)}
              </td>
              {variant === "admin" ? (
                <td className="px-3 py-2.5">
                  <TenantCell
                    tenantName={row.tenantName ?? row.businessName}
                    ownerName={row.ownerName}
                    ownerEmail={row.ownerEmail}
                  />
                </td>
              ) : null}
              <td className="px-3 py-2.5 capitalize text-on-surface-variant">
                {row.type === "subscription" ? "Subscription" : "SMS top-up"}
              </td>
              <td className="px-3 py-2.5 text-on-surface">
                {focus === "subscription" ? (
                  <>
                    <div className="font-semibold">
                      {row.planName ?? row.planId ?? "—"}
                    </div>
                    {row.planPriceLabel ? (
                      <div className="text-[11px] text-on-surface-variant">
                        {row.planPriceLabel}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="font-semibold">
                      {row.smsPackageName ?? row.smsPackageId ?? "—"}
                    </div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablePagination({
  page,
  totalPages,
  pageStart,
  pageEnd,
  totalItems,
  onPageChange,
  itemLabel,
}: {
  page: number;
  totalPages: number;
  pageStart: number;
  pageEnd: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  itemLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-outline-variant/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-body text-[12px] text-on-surface-variant">
        {totalItems === 0
          ? `No ${itemLabel}`
          : totalItems <= TENANT_USAGE_PAGE_SIZE
            ? `Showing ${totalItems} ${itemLabel}`
            : `Showing ${pageStart + 1}–${pageEnd} of ${totalItems} ${itemLabel}`}
      </p>
      {totalItems > TENANT_USAGE_PAGE_SIZE ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="material-symbols-outlined text-[18px]">
              chevron_left
            </span>
            Previous
          </button>
          <span className="min-w-[5.5rem] text-center font-body text-[12px] font-medium text-on-surface-variant">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
            <span className="material-symbols-outlined text-[18px]">
              chevron_right
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SectionSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block w-full sm:max-w-xs">
      <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
        Search
      </span>
      <div className="relative">
        <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
          search
        </span>
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-outline-variant bg-white py-2 pl-9 pr-3 font-body text-[13px] text-on-surface placeholder:text-on-surface-variant/70"
        />
      </div>
    </label>
  );
}

type CatalogItem = { id: string; name: string };

export function TenantPackageUsageLog({
  catalog,
  focus,
  catalogItems,
  groupBy,
  variant = "admin",
  showHeader = true,
}: {
  catalog: TenantPackageUsageCatalog | null;
  focus: "subscription" | "sms";
  catalogItems: CatalogItem[];
  groupBy: "plan" | "sms";
  variant?: "admin" | "tenant";
  showHeader?: boolean;
}) {
  const [filterId, setFilterId] = useState<string>("all");
  const [usageSearchQuery, setUsageSearchQuery] = useState("");
  const [purchaseSearchQuery, setPurchaseSearchQuery] = useState("");
  const [usagePage, setUsagePage] = useState(1);
  const [purchasePage, setPurchasePage] = useState(1);

  const usageRows = useMemo(() => {
    if (!catalog) return [];
    if (filterId === "all") return catalog.usage;
    if (groupBy === "plan") return catalog.usageByPlanId[filterId] ?? [];
    return catalog.usageBySmsPackageId[filterId] ?? [];
  }, [catalog, filterId, groupBy]);

  const purchaseRows = useMemo(() => {
    if (!catalog) return [];
    if (filterId === "all") return catalog.purchases;
    if (groupBy === "plan") {
      return catalog.purchases.filter((row) => row.planId === filterId);
    }
    return catalog.purchases.filter((row) => row.smsPackageId === filterId);
  }, [catalog, filterId, groupBy]);

  const usageFiltered = useMemo(
    () => usageRows.filter((row) => matchesUsageSearch(row, usageSearchQuery)),
    [usageRows, usageSearchQuery],
  );

  const purchaseFiltered = useMemo(() => {
    const byType =
      focus === "subscription"
        ? purchaseRows.filter((row) => row.type === "subscription")
        : purchaseRows.filter((row) => row.type === "sms_topup");
    return byType.filter((row) =>
      matchesPurchaseSearch(row, purchaseSearchQuery),
    );
  }, [purchaseRows, focus, purchaseSearchQuery]);

  const usagePagination = useMemo(
    () => paginateRows(usageFiltered, usagePage, TENANT_USAGE_PAGE_SIZE),
    [usageFiltered, usagePage],
  );

  const purchasePagination = useMemo(
    () => paginateRows(purchaseFiltered, purchasePage, TENANT_USAGE_PAGE_SIZE),
    [purchaseFiltered, purchasePage],
  );

  useEffect(() => {
    setUsagePage((current) => Math.min(current, usagePagination.totalPages));
  }, [usagePagination.totalPages]);

  useEffect(() => {
    setPurchasePage((current) =>
      Math.min(current, purchasePagination.totalPages),
    );
  }, [purchasePagination.totalPages]);

  const usageItemLabel = variant === "tenant" ? "entries" : "tenants";
  const usageSearchPlaceholder =
    variant === "tenant"
      ? "Package, balance, status…"
      : "Tenant, owner, package…";
  const purchaseSearchPlaceholder =
    variant === "tenant" ? "Package, type…" : "Tenant, owner, plan, package…";

  if (!catalog) return null;

  return (
    <section className="space-y-6">
      {showHeader ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-[18px] font-semibold text-on-surface">
              {variant === "tenant" ? "SMS usage" : "Tenant usage log"}
            </h2>
            <p className="mt-1 font-body text-[13px] text-on-surface-variant">
              {variant === "tenant"
                ? "Your current SMS assignment and Stripe purchase history."
                : "Which tenants use each package, their SMS assignment, and Stripe purchase history."}
            </p>
          </div>
          {variant === "admin" ? (
            <label className="block shrink-0">
              <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                Filter by package
              </span>
              <select
                value={filterId}
                onChange={(e) => {
                  setFilterId(e.target.value);
                  setUsagePage(1);
                  setPurchasePage(1);
                }}
                className="min-w-[220px] rounded-lg border border-outline-variant bg-white px-3 py-2 font-body text-[13px] text-on-surface"
              >
                <option value="all">All packages</option>
                {catalogItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-body text-[13px] font-semibold text-on-surface">
              Current assignments
            </h3>
            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
              {usageFiltered.length} {usageItemLabel} · {TENANT_USAGE_PAGE_SIZE}{" "}
              per page
            </p>
          </div>
          <SectionSearch
            value={usageSearchQuery}
            onChange={(value) => {
              setUsageSearchQuery(value);
              setUsagePage(1);
            }}
            placeholder={usageSearchPlaceholder}
          />
        </div>
        {usageFiltered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
            {usageSearchQuery.trim()
              ? variant === "tenant"
                ? "No assignment details match your search."
                : "No tenants match your search."
              : variant === "tenant"
                ? "No SMS package is assigned to your workshop yet."
                : "No tenants are using packages in this view yet."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-outline-variant bg-white">
            <UsageTable
              rows={usagePagination.rows}
              focus={focus}
              variant={variant}
            />
            <TablePagination
              page={usagePagination.safePage}
              totalPages={usagePagination.totalPages}
              pageStart={usagePagination.pageStart}
              pageEnd={usagePagination.pageEnd}
              totalItems={usagePagination.totalItems}
              onPageChange={setUsagePage}
              itemLabel={usageItemLabel}
            />
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-body text-[13px] font-semibold text-on-surface">
              Purchase history
            </h3>
            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
              {purchaseFiltered.length} purchase
              {purchaseFiltered.length === 1 ? "" : "s"} ·{" "}
              {TENANT_USAGE_PAGE_SIZE} per page
            </p>
          </div>
          <SectionSearch
            value={purchaseSearchQuery}
            onChange={(value) => {
              setPurchaseSearchQuery(value);
              setPurchasePage(1);
            }}
            placeholder={purchaseSearchPlaceholder}
          />
        </div>
        {purchaseFiltered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-outline-variant px-4 py-6 text-center font-body text-[12px] text-on-surface-variant">
            {purchaseSearchQuery.trim()
              ? "No purchases match your search."
              : "No Stripe purchases recorded yet for this category."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-outline-variant bg-white">
            <PurchaseTable
              rows={purchasePagination.rows}
              focus={focus}
              variant={variant}
            />
            <TablePagination
              page={purchasePagination.safePage}
              totalPages={purchasePagination.totalPages}
              pageStart={purchasePagination.pageStart}
              pageEnd={purchasePagination.pageEnd}
              totalItems={purchasePagination.totalItems}
              onPageChange={setPurchasePage}
              itemLabel="purchases"
            />
          </div>
        )}
      </div>
    </section>
  );
}
