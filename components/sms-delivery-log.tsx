"use client";

import { formatTenantDate } from "@/lib/onboarding/tenant-display";
import type { SmsLogEntry, SmsLogStatus } from "@/lib/sms/sms-log-types";
import { useEffect, useMemo, useState } from "react";

const SMS_LOG_PAGE_SIZE = 10;

function formatSourceLabel(source: string | null): string {
  if (!source) return "—";
  return source.replace(/_/g, " ");
}

function formatStatusDetail(detail: string | null): string {
  if (!detail) return "";
  return detail.replace(/_/g, " ");
}

function statusBadgeClass(status: SmsLogStatus): string {
  if (status === "sent") return "bg-emerald-100 text-emerald-800";
  if (status === "skipped") return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-800";
}

function matchesSmsLogSearch(row: SmsLogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.senderName,
    row.receiverPhone,
    row.receiverName,
    row.message,
    row.status,
    row.statusDetail,
    row.source,
    row.businessId,
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

export function SmsDeliveryLog({
  logs,
  variant = "admin",
  showHeader = true,
}: {
  logs: SmsLogEntry[];
  variant?: "admin" | "tenant";
  showHeader?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () => logs.filter((row) => matchesSmsLogSearch(row, searchQuery)),
    [logs, searchQuery],
  );

  const pagination = useMemo(
    () => paginateRows(filtered, page, SMS_LOG_PAGE_SIZE),
    [filtered, page],
  );

  useEffect(() => {
    setPage((current) => Math.min(current, pagination.totalPages));
  }, [pagination.totalPages]);

  const searchField = (
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
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          placeholder={
            variant === "tenant"
              ? "Receiver, message, status…"
              : "Sender, receiver, message…"
          }
          className="w-full rounded-lg border border-outline-variant bg-white py-2 pl-9 pr-3 font-body text-[13px] text-on-surface placeholder:text-on-surface-variant/70"
        />
      </div>
    </label>
  );

  return (
    <section className="space-y-4">
      {showHeader ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-[18px] font-semibold text-on-surface">
              {variant === "tenant" ? "Your SMS log" : "SMS log"}
            </h2>
            <p className="mt-1 font-body text-[13px] text-on-surface-variant">
              {variant === "tenant"
                ? "Messages sent from your workshop — recipient, content, status, and time."
                : "Outbound SMS history — sender, receiver, message, status, and time."}
            </p>
            <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
              {filtered.length} entr{filtered.length === 1 ? "y" : "ies"} ·{" "}
              {SMS_LOG_PAGE_SIZE} per page
            </p>
          </div>
          {searchField}
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <p className="font-body text-[12px] text-on-surface-variant">
            {filtered.length} entr{filtered.length === 1 ? "y" : "ies"} ·{" "}
            {SMS_LOG_PAGE_SIZE} per page
          </p>
          {searchField}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center font-body text-[13px] text-on-surface-variant">
          {searchQuery.trim()
            ? "No SMS log entries match your search."
            : "No SMS messages have been logged yet."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left font-body text-[12px]">
              <thead className="border-b border-outline-variant bg-surface-container-lowest">
                <tr>
                  <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                    When
                  </th>
                  {variant === "admin" ? (
                    <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                      Sender
                    </th>
                  ) : null}
                  <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                    Receiver
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                    Message
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                    Status
                  </th>
                  <th className="px-3 py-2.5 font-semibold text-on-surface-variant">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {pagination.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-container-lowest/80">
                    <td className="whitespace-nowrap px-3 py-2.5 text-on-surface-variant">
                      {formatTenantDate(row.createdAt)}
                    </td>
                    {variant === "admin" ? (
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-on-surface">
                          {row.senderName}
                        </p>
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-on-surface">
                        {row.receiverPhone}
                      </p>
                      {row.receiverName ? (
                        <p className="text-[11px] text-on-surface-variant">
                          {row.receiverName}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5 text-on-surface">
                      <p className="line-clamp-3 whitespace-pre-wrap break-words">
                        {row.message || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBadgeClass(row.status)}`}
                      >
                        {row.status}
                      </span>
                      {row.statusDetail ? (
                        <p className="mt-1 text-[11px] capitalize text-on-surface-variant">
                          {formatStatusDetail(row.statusDetail)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 capitalize text-on-surface-variant">
                      {formatSourceLabel(row.source)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination.totalItems > SMS_LOG_PAGE_SIZE ? (
            <div className="flex flex-col gap-3 border-t border-outline-variant/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-body text-[12px] text-on-surface-variant">
                Showing {pagination.pageStart + 1}–{pagination.pageEnd} of{" "}
                {pagination.totalItems}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => current - 1)}
                  disabled={pagination.safePage <= 1}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    chevron_left
                  </span>
                  Previous
                </button>
                <span className="min-w-[5.5rem] text-center font-body text-[12px] font-medium text-on-surface-variant">
                  Page {pagination.safePage} of {pagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={pagination.safePage >= pagination.totalPages}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next
                  <span className="material-symbols-outlined text-[18px]">
                    chevron_right
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
