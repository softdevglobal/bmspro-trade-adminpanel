"use client";

import { auth } from "@/lib/firebase/client";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import type { BusinessSmsBalance } from "@/lib/sms-packages/balance";
import { useCallback, useEffect, useMemo, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const MAX_MESSAGE_LENGTH = 480;

const QUICK_TEMPLATES: Array<{ label: string; text: string }> = [
  {
    label: "Season's greetings",
    text: "Season's greetings from our team! Thank you for your support this year. We wish you a safe and happy holiday season.",
  },
  {
    label: "Merry Christmas",
    text: "Merry Christmas from all of us! We appreciate your business and look forward to working with you again soon.",
  },
  {
    label: "Happy New Year",
    text: "Happy New Year! Thank you for trusting us this year. Wishing you health and happiness in the year ahead.",
  },
];

type CustomerContact = {
  id: string;
  fullName: string;
  phone: string;
};

type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function authFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<FetchResult<T>> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Please sign in again." };
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: (T & { ok?: boolean; error?: string }) | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as T & { ok?: boolean; error?: string };
    } catch {
      return { ok: false, error: "Invalid response from server." };
    }
  }
  if (!response.ok || !body || body.ok === false) {
    return { ok: false, error: body?.error ?? "Request failed." };
  }
  return { ok: true, data: body };
}

export function OwnerCustomMessagesBoard() {
  const [customers, setCustomers] = useState<CustomerContact[]>([]);
  const [balance, setBalance] = useState<BusinessSmsBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"all" | "select">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await authFetch<{
      customers: CustomerContact[];
      balance: BusinessSmsBalance | null;
    }>("/api/business/custom-messages");
    if (result.ok) {
      setCustomers(result.data.customers ?? []);
      setBalance(result.data.balance ?? null);
      setListError(null);
    } else {
      setListError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((customer) => {
      const displayPhone = formatAuPhoneDisplay(customer.phone).toLowerCase();
      return (
        customer.fullName.toLowerCase().includes(q) ||
        customer.phone.includes(q) ||
        displayPhone.includes(q)
      );
    });
  }, [customers, query]);

  const recipientCount = useMemo(() => {
    if (mode === "all") return customers.length;
    return customers.filter((customer) => selectedIds.has(customer.id)).length;
  }, [mode, customers, selectedIds]);

  const remaining =
    balance && !balance.isUnlimited ? (balance.remaining ?? 0) : null;
  const insufficientCredits =
    remaining !== null && recipientCount > remaining;

  const canSubmit =
    message.trim().length > 0 &&
    recipientCount > 0 &&
    !insufficientCredits &&
    !sending;

  function toggleCustomer(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const customer of filtered) next.add(customer.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!message.trim()) {
      setFormError("Write a message to send.");
      return;
    }
    if (recipientCount === 0) {
      setFormError("Select at least one customer to message.");
      return;
    }
    if (insufficientCredits) {
      setFormError("Not enough SMS credits for this many recipients.");
      return;
    }

    setSending(true);
    const result = await authFetch<{ sentCount: number; requestedCount: number }>(
      "/api/business/custom-messages",
      {
        method: "POST",
        body: JSON.stringify({
          message: message.trim(),
          recipients:
            mode === "all" ? "all" : Array.from(selectedIds),
        }),
      },
    );
    setSending(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    const sent = result.data.sentCount ?? 0;
    setSuccessMessage(
      `Message sent to ${sent} customer${sent === 1 ? "" : "s"}.`,
    );
    setMessage("");
    setSelectedIds(new Set());
    void load();
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Balance summary */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-outline-variant bg-surface p-4 shadow-sm">
        <span className="material-symbols-outlined text-primary">sms</span>
        <div className="min-w-0">
          <p className="font-body text-[13px] font-semibold text-on-surface">
            SMS balance
          </p>
          <p className="font-body text-[12px] text-on-surface-variant">
            {balance == null
              ? "Unavailable"
              : balance.isUnlimited
                ? "Unlimited messages"
                : `${remaining ?? 0} messages remaining`}
          </p>
        </div>
      </div>

      {/* Compose */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">edit_note</span>
          <h3 className="font-display text-[17px] font-bold text-on-surface">
            New message
          </h3>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block font-body text-[13px] font-semibold text-on-surface">
              Message
            </label>
            <textarea
              value={message}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="Write the SMS your customers will receive."
              className={`${INPUT_CLASS} resize-y`}
            />
            <p className="mt-1 text-right font-body text-[11px] text-on-surface-variant">
              {message.length}/{MAX_MESSAGE_LENGTH}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => setMessage(template.text)}
                  className="inline-flex items-center gap-1 rounded-full border border-outline-variant px-3 py-1 font-body text-[12px] font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    auto_awesome
                  </span>
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recipients */}
          <fieldset className="rounded-xl border border-outline-variant p-3">
            <legend className="px-1 font-body text-[12px] font-semibold text-on-surface-variant">
              Send to
            </legend>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 font-body text-[14px] text-on-surface">
              <input
                type="radio"
                name="recipients"
                checked={mode === "all"}
                onChange={() => setMode("all")}
                className="h-4 w-4 accent-primary"
              />
              All customers ({customers.length})
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1.5 font-body text-[14px] text-on-surface">
              <input
                type="radio"
                name="recipients"
                checked={mode === "select"}
                onChange={() => setMode("select")}
                className="h-4 w-4 accent-primary"
              />
              Select customers
            </label>

            {mode === "select" ? (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name or phone"
                    className={`${INPUT_CLASS} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={selectAllFiltered}
                    className="rounded-lg border border-outline-variant px-3 py-2 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-lg border border-outline-variant px-3 py-2 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
                  >
                    Clear
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto rounded-lg border border-outline-variant/70">
                  {filtered.length === 0 ? (
                    <p className="px-3 py-6 text-center font-body text-[13px] text-on-surface-variant">
                      {customers.length === 0
                        ? "No customers with a phone number yet."
                        : "No customers match your search."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-outline-variant/60">
                      {filtered.map((customer) => (
                        <li key={customer.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-container-low">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(customer.id)}
                              onChange={() => toggleCustomer(customer.id)}
                              className="h-4 w-4 accent-primary"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-body text-[14px] text-on-surface">
                                {customer.fullName}
                              </span>
                              <span className="block truncate font-body text-[12px] text-on-surface-variant">
                                {formatAuPhoneDisplay(customer.phone) ||
                                  customer.phone}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </fieldset>

          {listError ? (
            <p className="rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">
              {listError}
            </p>
          ) : null}
          {insufficientCredits ? (
            <p className="rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">
              You need {recipientCount} credits but only {remaining ?? 0}{" "}
              remain. Top up in SMS credits or select fewer customers.
            </p>
          ) : null}
          {formError ? (
            <p className="rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">
              {formError}
            </p>
          ) : null}
          {successMessage ? (
            <p className="rounded-lg bg-primary/10 px-3 py-2 font-body text-[13px] text-primary">
              {successMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-body text-[13px] text-on-surface-variant">
              {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
              {recipientCount > 0
                ? ` · ${recipientCount} SMS credit${recipientCount === 1 ? "" : "s"}`
                : ""}
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[18px] ${
                  sending ? "animate-spin" : ""
                }`}
              >
                {sending ? "progress_activity" : "send"}
              </span>
              {sending ? "Sending..." : "Send SMS"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
