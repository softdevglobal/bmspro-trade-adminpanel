"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { emailApi } from "@/lib/email-integration/client";
import type {
  MailboxCustomerContext,
  MailboxMatch,
  PlatformDocumentRef,
} from "@/lib/email-integration/types";
import Link from "next/link";
import { useEffect, useState } from "react";

function formatAud(value: number): string {
  return `$${value.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(timestamp: number | null): string {
  return timestamp
    ? new Date(timestamp).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
    : "";
}

const STATUS_TONES: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700",
  accepted: "bg-emerald-50 text-emerald-700",
  completed: "bg-emerald-50 text-emerald-700",
  sent: "bg-sky-50 text-sky-700",
  scheduled: "bg-sky-50 text-sky-700",
  confirmed: "bg-sky-50 text-sky-700",
  draft: "bg-slate-100 text-slate-600",
  pending: "bg-amber-50 text-amber-700",
  declined: "bg-rose-50 text-rose-700",
  cancelled: "bg-rose-50 text-rose-700",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-body text-[10px] font-bold uppercase tracking-wide ${
        STATUS_TONES[status.toLowerCase()] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** Visual chip for how a conversation relates to the platform. */
export function MatchChip({ match, compact = false }: { match: MailboxMatch; compact?: boolean }) {
  const doc = match.document;
  if (doc?.type === "quote") {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 font-body text-[11px] font-semibold text-violet-700">
        <span className="material-symbols-outlined text-[13px]">request_quote</span>
        <span className="truncate">{compact ? doc.code ?? "Quote" : `Quote ${doc.code ?? ""}`.trim()}</span>
      </span>
    );
  }
  if (doc?.type === "invoice") {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-body text-[11px] font-semibold text-emerald-700">
        <span className="material-symbols-outlined text-[13px]">receipt_long</span>
        <span className="truncate">{compact ? doc.code ?? "Invoice" : `Invoice ${doc.code ?? ""}`.trim()}</span>
      </span>
    );
  }
  if (match.method === "none") return null;
  const name = match.customerName ?? (match.customerEmails.length > 1 ? "Customers" : match.customerEmails.length === 1 ? "Customer" : null);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-body text-[11px] font-semibold text-primary">
      <span className="material-symbols-outlined text-[13px]">
        {match.method === "platform_thread" ? "verified" : name ? "person" : "forum"}
      </span>
      <span className="truncate">
        {name ?? (match.method === "platform_thread" ? "Sent from BMS Pro" : "Customer conversation")}
      </span>
    </span>
  );
}

function documentHref(doc: PlatformDocumentRef): string | null {
  if (!doc.id) return null;
  if (doc.type === "quote") return `/dashboard/quotations?view=${encodeURIComponent(doc.id)}`;
  if (doc.type === "invoice") return `/dashboard/invoices?view=${encodeURIComponent(doc.id)}`;
  return null;
}

/** Why the conversation is linked, and what the business has with the customer. */
export function MailCustomerPanel({
  match,
  onEmailCustomer,
}: {
  match: MailboxMatch;
  onEmailCustomer: (email: string) => void;
}) {
  const { user } = useAuth();
  const email = match.customerEmails[0] ?? null;
  const [customer, setCustomer] = useState<MailboxCustomerContext | null>(null);
  const [loading, setLoading] = useState(Boolean(email));

  useEffect(() => {
    if (!user || !email) return;
    let active = true;
    void emailApi<{ customer: MailboxCustomerContext }>(
      user,
      `/api/email/mailbox/customer?email=${encodeURIComponent(email)}`,
    )
      .then((payload) => {
        if (active) setCustomer(payload.customer);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, email]);

  const doc = match.document;
  const docHref = doc ? documentHref(doc) : null;

  if (match.method === "none") {
    return (
      <aside className="rounded-2xl border border-dashed border-outline-variant/70 px-4 py-5 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-variant">link_off</span>
        <p className="mt-1 font-body text-[13px] font-semibold text-on-surface">Not linked to a customer</p>
        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
          Add this sender as a customer, or send them a quote, and their emails link here automatically.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-white to-white">
        <div className="flex items-center gap-2 border-b border-primary/10 px-4 py-2">
          <span className="material-symbols-outlined text-[16px] text-primary">hub</span>
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">Linked to BMS Pro</p>
        </div>

        {doc?.type ? (
          <div className="border-b border-primary/10 px-4 py-3">
            <p className="font-body text-[11px] text-on-surface-variant">This conversation started with</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <MatchChip match={match} />
              {docHref ? (
                <Link href={docHref} className="font-body text-[12px] font-semibold text-primary hover:underline">
                  Open
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {email ? (
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary font-body text-[15px] font-bold text-white">
                {(customer?.name ?? match.customerName ?? email).trim()[0]?.toUpperCase() ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="truncate font-body text-[14px] font-semibold text-on-surface">
                  {customer?.name ?? match.customerName ?? "Customer"}
                </p>
                <p className="truncate font-body text-[12px] text-on-surface-variant">{email}</p>
                {customer?.phone ? (
                  <p className="font-body text-[12px] text-on-surface-variant">{customer.phone}</p>
                ) : null}
              </div>
            </div>
            {match.customerEmails.length > 1 ? (
              <p className="mt-2 font-body text-[11px] text-on-surface-variant">
                Also with {match.customerEmails.slice(1).join(", ")}
              </p>
            ) : null}

            {loading ? (
              <div className="mt-3 h-16 animate-pulse rounded-xl bg-surface-container-low" />
            ) : customer ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: "Quotes", value: customer.quotes.length, icon: "request_quote" },
                  { label: "Invoices", value: customer.invoices.length, icon: "receipt_long" },
                  { label: "Jobs", value: customer.jobs.length, icon: "assignment" },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-xl bg-white/80 px-2 py-2 text-center ring-1 ring-outline-variant/40">
                    <span className="material-symbols-outlined text-[18px] text-primary">{tile.icon}</span>
                    <p className="font-display text-[16px] font-semibold text-on-surface">{tile.value}</p>
                    <p className="font-body text-[10px] uppercase tracking-wide text-on-surface-variant">{tile.label}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => onEmailCustomer(email)}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-white px-3 py-2 font-body text-[12px] font-semibold text-primary hover:bg-primary/5"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              New email to this customer
            </button>
          </div>
        ) : null}
      </div>

      {customer && (customer.quotes.length > 0 || customer.invoices.length > 0 || customer.jobs.length > 0) ? (
        <div className="space-y-3 rounded-2xl border border-outline-variant/60 bg-white px-4 py-3">
          {customer.quotes.length > 0 ? (
            <section>
              <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Quotes</p>
              <ul className="mt-1.5 space-y-1.5">
                {customer.quotes.map((quote) => (
                  <li key={quote.id}>
                    <Link
                      href={`/dashboard/quotations?view=${encodeURIComponent(quote.id)}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-container-low"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[12px] font-semibold text-on-surface">{quote.code}</span>
                        <span className="block font-body text-[11px] text-on-surface-variant">
                          {formatAud(quote.amountAud)} · {formatDate(quote.date)}
                        </span>
                      </span>
                      <StatusPill status={quote.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {customer.invoices.length > 0 ? (
            <section>
              <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Invoices</p>
              <ul className="mt-1.5 space-y-1.5">
                {customer.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      href={`/dashboard/invoices?view=${encodeURIComponent(invoice.id)}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-container-low"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[12px] font-semibold text-on-surface">{invoice.code}</span>
                        <span className="block font-body text-[11px] text-on-surface-variant">
                          {invoice.status === "paid" ? "Paid" : `${formatAud(invoice.amountAud)} due`} · {formatDate(invoice.date)}
                        </span>
                      </span>
                      <StatusPill status={invoice.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {customer.jobs.length > 0 ? (
            <section>
              <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Jobs</p>
              <ul className="mt-1.5 space-y-1.5">
                {customer.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href="/dashboard/jobs"
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-container-low"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[12px] font-semibold text-on-surface">{job.code}</span>
                        <span className="block font-body text-[11px] text-on-surface-variant">{formatDate(job.date)}</span>
                      </span>
                      <StatusPill status={job.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
