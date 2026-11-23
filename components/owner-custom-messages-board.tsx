"use client";

import {
  matchSmsCustomers, previewOutboundMessage, SMS_LIMITS, SMS_TEMPLATES, SMS_VOICE_HEADER, smsMessageVoice, smsSendReadBack,
  type SmsCustomer, type SmsMessageArgs,
} from "@/lib/ai/owner-call/owner-sms";
import type { VoiceResult } from "@/lib/ai/owner-call/owner-team";
import { scrollTarget } from "@/lib/ai/owner-call/owner-page";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { auth } from "@/lib/firebase/client";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import type { BusinessSmsBalance } from "@/lib/sms-packages/balance";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const MAX_MESSAGE_LENGTH = SMS_LIMITS.messageMax;

/** Quick templates; Sophie picks the same ones by id (lib/ai/owner-call/owner-sms.ts). */
const QUICK_TEMPLATES = Object.values(SMS_TEMPLATES);

type CustomerContact = SmsCustomer;

/** Filters customers like the search box: name or phone (as stored or as shown). */
function filterCustomers(customers: CustomerContact[], query: string): CustomerContact[] {
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
}

/** What a voice read-back covered: a send must match it exactly. */
const sendSignature = (message: string, mode: "all" | "select", ids: Set<string>) =>
  JSON.stringify([message.trim(), mode, mode === "all" ? [] : [...ids].sort()]);

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
  const business = useBusinessProfile();
  const businessName = business?.businessName?.trim() || null;

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

  const outboundPreview = useMemo(
    () => previewOutboundMessage(message, businessName),
    [message, businessName],
  );

  const prefixLength = useMemo(() => {
    if (!businessName) return 0;
    if (
      message
        .trim()
        .toLowerCase()
        .startsWith(`${businessName.toLowerCase()}:`)
    ) {
      return 0;
    }
    return `${businessName}: `.length;
  }, [businessName, message]);

  const maxBodyLength = Math.max(0, MAX_MESSAGE_LENGTH - prefixLength);

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

  const filtered = useMemo(() => filterCustomers(customers, query), [customers, query]);

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
    outboundPreview.length <= MAX_MESSAGE_LENGTH &&
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

  /** Sends what is on screen. Shared by the Send SMS button and Sophie (`voice` marks it for the voice send limit). */
  async function sendMessage(
    draft: { message: string; mode: "all" | "select"; selectedIds: Set<string> },
    voice = false,
  ): Promise<{ ok: true; sent: number; requested: number } | { ok: false; error: string }> {
    setFormError(null);
    setSuccessMessage(null);
    setSending(true);
    const result = await authFetch<{ sentCount: number; requestedCount: number }>(
      "/api/business/custom-messages",
      {
        method: "POST",
        headers: voice ? { [SMS_VOICE_HEADER]: "1" } : {},
        body: JSON.stringify({
          message: draft.message.trim(),
          recipients: draft.mode === "all" ? "all" : Array.from(draft.selectedIds),
        }),
      },
    );
    setSending(false);

    if (!result.ok) {
      setFormError(result.error);
      return { ok: false, error: result.error };
    }

    const sent = result.data.sentCount ?? 0;
    setSuccessMessage(
      `Message sent to ${sent} customer${sent === 1 ? "" : "s"}.`,
    );
    setMessage("");
    setSelectedIds(new Set());
    void load();
    return { ok: true, sent, requested: result.data.requestedCount ?? sent };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!message.trim()) {
      setFormError("Write a message to send.");
      return;
    }
    if (outboundPreview.length > MAX_MESSAGE_LENGTH) {
      setFormError(
        `Message is too long (max ${MAX_MESSAGE_LENGTH} characters including business name).`,
      );
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

    await sendMessage({ message, mode, selectedIds });
  }

  // ---- Sophie (voice and chat). See lib/ai/owner-call/owner-sms.ts. ----
  // A mirror of the page state that voice steps read and update at once, so two steps in a row
  // never see an old render. Every change also goes through the normal setters.
  const live = useRef({ message, mode, selectedIds, query, customers, balance, businessName, sending });
  /** What the last voice read-back covered; null when nothing was read back. */
  const reviewed = useRef<string | null>(null);
  const voice = useRef({ sendMessage });
  useEffect(() => {
    live.current = { message, mode, selectedIds, query, customers, balance, businessName, sending };
    voice.current = { sendMessage };
  });

  // Registered once the customers have loaded, so Sophie never works on an empty list.
  useEffect(() => loading ? undefined : smsMessageVoice.register({
    customers(search) {
      setQuery(search);
      live.current.query = search;
      return filterCustomers(live.current.customers, search);
    },
    async step(args: SmsMessageArgs): Promise<VoiceResult> {
      const state = live.current;
      const prefix = previewOutboundMessage("x", state.businessName).length - 1;
      const writeText = (value: string) => { state.message = value; setMessage(value); };
      const setPick = (next: Set<string>) => { state.selectedIds = next; setSelectedIds(next); };
      const pickedCount = () => state.mode === "all"
        ? state.customers.length
        : state.customers.filter((customer) => state.selectedIds.has(customer.id)).length;
      const ok = (message: string, extra: Record<string, unknown> = {}) =>
        ({ status: "OK", recipients: pickedCount(), ...extra, message });
      /** Brings the Send to box into view so the owner sees the change. */
      const showRecipients = () =>
        document.querySelector<HTMLElement>("[data-voice-section='recipients']")?.scrollIntoView({ behavior: "smooth", block: "center" });

      switch (args.action) {
        case "write": {
          const value = (args.message ?? "").trim();
          if (!value) return { status: "REJECTED", message: "Send the message text." };
          const outbound = previewOutboundMessage(value, state.businessName);
          if (outbound.length > MAX_MESSAGE_LENGTH) {
            return { status: "TOO_LONG", length: outbound.length, max: MAX_MESSAGE_LENGTH,
              message: `That is ${outbound.length} characters with the business name; the limit is ${MAX_MESSAGE_LENGTH}. Offer a shorter version. Nothing was typed.` };
          }
          writeText(value);
          return ok("Typed. Ask who should get it if not said yet, then review.", { outbound });
        }
        case "template": {
          const template = args.template ? SMS_TEMPLATES[args.template] : null;
          if (!template) return { status: "REJECTED", message: "Unknown template." };
          writeText(template.text.slice(0, Math.max(0, MAX_MESSAGE_LENGTH - prefix)));
          return ok(`The ${template.label} template is in the message box.`, { outbound: previewOutboundMessage(state.message, state.businessName) });
        }
        case "recipients_all":
          if (!state.customers.length) {
            return { status: "NO_CUSTOMERS", message: "No customers have a phone number yet, so there is nobody to text." };
          }
          // Like pressing All customers: the ticks and the customer search no longer apply.
          state.mode = "all";
          setMode("all");
          state.query = "";
          setQuery("");
          showRecipients();
          return ok(`All customers is selected: ${state.customers.length} customers.`);
        case "recipients_select": {
          const add = matchSmsCustomers(state.customers, args.add ?? []);
          if (!add.ok) return add.result;
          const remove = matchSmsCustomers(state.customers, args.remove ?? []);
          if (!remove.ok) return remove.result;
          const next = new Set(state.mode === "select" ? state.selectedIds : []);
          for (const customer of add.matched) next.add(customer.id);
          for (const customer of remove.matched) next.delete(customer.id);
          state.mode = "select";
          setMode("select");
          setPick(next);
          // A search that hides a ticked customer would make the tick invisible: clear it.
          if (state.query && add.matched.some((customer) => !filterCustomers([customer], state.query).length)) {
            state.query = "";
            setQuery("");
          }
          showRecipients();
          const picked = state.customers.filter((customer) => next.has(customer.id)).map((customer) => customer.fullName);
          return ok(`Select customers is on. Ticked: ${picked.join(", ") || "nobody yet"}.`, { selected: picked.slice(0, 20) });
        }
        case "search":
          state.query = args.query ?? "";
          setQuery(state.query);
          if (state.mode !== "select") { state.mode = "select"; setMode("select"); }
          return { status: "SEARCHED", shown: filterCustomers(state.customers, state.query).length,
            message: "The customer search shows the matches. Say who to tick, or select_all_shown to tick them all." };
        case "select_all_shown": {
          const next = new Set(state.mode === "select" ? state.selectedIds : []);
          for (const customer of filterCustomers(state.customers, state.query)) next.add(customer.id);
          state.mode = "select";
          setMode("select");
          setPick(next);
          return ok(`Ticked everyone shown by the search${state.query ? ` "${state.query}"` : ""}.`);
        }
        case "clear_selection":
          setPick(new Set());
          return ok("Nobody is ticked now.");
        case "scroll_down":
        case "scroll_up": {
          const target = scrollTarget();
          target.scrollBy({ top: (args.action === "scroll_down" ? 1 : -1) * target.clientHeight * 0.7, behavior: "smooth" });
          return { status: "SCROLLED", message: "Scrolled." };
        }
        case "review": {
          const recipients = state.mode === "all"
            ? state.customers
            : state.customers.filter((customer) => state.selectedIds.has(customer.id));
          const check = smsSendReadBack({
            message: state.message, businessName: state.businessName, recipients, all: state.mode === "all", balance: state.balance,
          });
          if (!check.ok) { reviewed.current = null; return check.result; }
          reviewed.current = sendSignature(state.message, state.mode, state.selectedIds);
          document.querySelector<HTMLElement>("[data-voice-section='send']")?.scrollIntoView({ behavior: "smooth", block: "center" });
          return { status: "REVIEW", ...check.details, summary: check.summary,
            message: `Read this back: ${check.summary} Then ask: Should I send it? It cannot be undone.` };
        }
        case "send": {
          if (state.sending) return { status: "BUSY", message: "It is already sending." };
          if (!reviewed.current || reviewed.current !== sendSignature(state.message, state.mode, state.selectedIds)) {
            reviewed.current = null;
            return { status: "NOT_REVIEWED", message: "The message or recipients changed since the read-back. Review again and ask." };
          }
          reviewed.current = null;
          const result = await voice.current.sendMessage({ message: state.message, mode: state.mode, selectedIds: state.selectedIds }, true);
          if (!result.ok) return { status: "FAILED", message: `${result.error} Nothing more was sent.` };
          state.message = "";
          state.selectedIds = new Set();
          return { status: "SENT", sentCount: result.sent, requestedCount: result.requested,
            message: `Sent to ${result.sent} of ${result.requested} customers. Tell the owner.` };
        }
        case "cancel":
          reviewed.current = null;
          return { status: "CANCELLED", message: "Nothing was sent. The message is still on the page." };
        default:
          return { status: "REJECTED", message: "Unknown action." };
      }
    },
  }), [loading]);

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
              maxLength={maxBodyLength}
              onChange={(event) => setMessage(event.target.value)}
              rows={4}
              placeholder="Write the SMS your customers will receive."
              className={`${INPUT_CLASS} resize-y`}
            />
            <p className="mt-1 text-right font-body text-[11px] text-on-surface-variant">
              {outboundPreview.length}/{MAX_MESSAGE_LENGTH}
              {businessName ? " (includes business name)" : ""}
            </p>
            {businessName && message.trim() ? (
              <p className="mt-2 rounded-lg bg-surface-container-low px-3 py-2 font-body text-[12px] text-on-surface-variant">
                Customers will receive:{" "}
                <span className="text-on-surface">{outboundPreview}</span>
              </p>
            ) : businessName ? (
              <p className="mt-2 font-body text-[12px] text-on-surface-variant">
                Your business name ({businessName}) is added to every message.
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() =>
                    setMessage(template.text.slice(0, maxBodyLength))
                  }
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
          <fieldset data-voice-section="recipients" className="rounded-xl border border-outline-variant p-3">
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

          <div data-voice-section="send" className="flex flex-wrap items-center justify-between gap-3">
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
