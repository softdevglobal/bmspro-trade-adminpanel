"use client";

import type {
  BusinessClosure,
  ClosureConflictItem,
} from "@/lib/calendar/business-closures/types";
import { formatAuPhoneDisplay, formatAuPhoneTelHref } from "@/lib/phone/au-phone";
import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useState } from "react";

export function MarkBusinessClosureModal({
  open,
  date,
  dateLabel,
  isClosed,
  closure,
  onClose,
  onChanged,
}: {
  open: boolean;
  date: string;
  dateLabel: string;
  isClosed: boolean;
  closure: BusinessClosure | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [conflicts, setConflicts] = useState<ClosureConflictItem[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open || !user || !date) return;

    let cancelled = false;
    setLoadingPreview(true);
    setError(null);
    setAcknowledged(false);
    setReason(closure?.reason ?? "");

    void (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/calendar/business-closures?date=${encodeURIComponent(date)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          conflicts?: ClosureConflictItem[];
          error?: string;
        };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Could not load day details.");
        }
        if (!cancelled) setConflicts(payload.conflicts ?? []);
      } catch (previewError) {
        if (!cancelled) {
          setError(
            previewError instanceof Error
              ? previewError.message
              : "Could not load day details.",
          );
          setConflicts([]);
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user, date, closure?.reason]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  async function handleMarkOffDay() {
    if (!user) return;
    setSaving(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/calendar/business-closures", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          date,
          reason: reason.trim() || null,
          acknowledgedConflicts: acknowledged,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        conflicts?: ClosureConflictItem[];
      };

      if (!response.ok || !payload.ok) {
        if (payload.conflicts?.length) {
          setConflicts(payload.conflicts);
        }
        throw new Error(payload.error ?? "Could not mark this day as off.");
      }

      onChanged();
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not mark this day as off.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReopenDay() {
    if (!user) return;
    setSaving(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/calendar/business-closures?date=${encodeURIComponent(date)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not reopen this day.");
      }

      onChanged();
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not reopen this day.",
      );
    } finally {
      setSaving(false);
    }
  }

  const needsAcknowledgement = !isClosed && conflicts.length > 0;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        disabled={saving}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-closure-title"
        className="relative z-10 grid max-h-[92dvh] w-full max-w-lg grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl sm:rounded-2xl"
      >
        <header className="border-b border-outline-variant px-5 py-4 sm:px-6">
          <h2
            id="business-closure-title"
            className="font-display text-headline-sm font-semibold text-on-surface"
          >
            {isClosed ? "Business off day" : "Mark business off day"}
          </h2>
          <p className="mt-1 font-body text-[13px] text-on-surface-variant">
            {dateLabel}
          </p>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
          {error ? (
            <div className="mb-4 rounded-xl border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              {error}
            </div>
          ) : null}

          {isClosed ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="font-body text-[13px] font-semibold text-amber-900">
                  This day is closed for the whole business.
                </p>
                <p className="mt-1 font-body text-[12px] leading-relaxed text-amber-800">
                  Customers cannot submit new requests for this date on your
                  booking portal. Use Reactivate day below when you are open
                  again.
                </p>
                {closure?.reason ? (
                  <p className="mt-2 font-body text-[12px] text-amber-900">
                    Reason: {closure.reason}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="font-body text-[13px] leading-relaxed text-on-surface-variant">
                Mark this date as a holiday or emergency closure for your entire
                business. Customers will not be able to request that day on your
                booking page.
              </p>

              <label className="block">
                <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Reason (optional)
                </span>
                <input
                  type="text"
                  value={reason}
                  disabled={saving}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Public holiday, emergency closure"
                  className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-white px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
                />
              </label>

              {loadingPreview ? (
                <p className="font-body text-[12px] text-on-surface-variant">
                  Checking scheduled jobs and requests…
                </p>
              ) : conflicts.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4">
                  <p className="font-body text-[13px] font-semibold text-amber-900">
                    {conflicts.length} scheduled item
                    {conflicts.length === 1 ? "" : "s"} on this day
                  </p>
                  <p className="mt-1 font-body text-[12px] leading-relaxed text-amber-800">
                    Contact these customers before marking the day off. Existing
                    jobs and visits are not cancelled automatically.
                  </p>
                  <ul className="mt-3 space-y-3">
                    {conflicts.map((item) => (
                      <li
                        key={`${item.kind}-${item.id}`}
                        className="rounded-lg border border-amber-200/80 bg-white px-3 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-body text-[12px] font-bold uppercase tracking-wide text-amber-800">
                              {item.kind === "job" ? "Job" : "Inspection request"}
                            </p>
                            <p className="mt-0.5 font-body text-[13px] font-semibold text-on-surface">
                              {item.title}
                            </p>
                            <p className="font-body text-[12px] text-on-surface-variant">
                              {item.reference} · {item.timeLabel}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-body text-[12px] text-on-surface">
                          <span>{item.customerName}</span>
                          {item.customerPhone ? (
                            (() => {
                              const phoneHref = formatAuPhoneTelHref(item.customerPhone);
                              const phoneLabel = formatAuPhoneDisplay(item.customerPhone);
                              return phoneHref ? (
                                <a
                                  href={phoneHref}
                                  className="font-semibold text-primary hover:underline"
                                >
                                  {phoneLabel}
                                </a>
                              ) : (
                                <span>{phoneLabel}</span>
                              );
                            })()
                          ) : null}
                          {item.customerEmail ? (
                            <a
                              href={`mailto:${item.customerEmail}`}
                              className="font-semibold text-primary hover:underline"
                            >
                              {item.customerEmail}
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <label className="mt-4 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={saving}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
                    />
                    <span className="font-body text-[12px] leading-relaxed text-amber-900">
                      I have contacted or will contact affected customers about
                      this closure.
                    </span>
                  </label>
                </div>
              ) : (
                <p className="rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 py-2.5 font-body text-[12px] text-on-surface-variant">
                  No scheduled jobs or inspection requests on this day.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-outline-variant bg-surface-container-low px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-outline-variant bg-surface-container-lowest px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-60"
          >
            Cancel
          </button>
          {isClosed ? (
            <button
              type="button"
              onClick={() => void handleReopenDay()}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Reactivating…" : "Reactivate day"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleMarkOffDay()}
              disabled={saving || (needsAcknowledgement && !acknowledged)}
              className="rounded-lg bg-[#b45309] px-4 py-2.5 font-body text-[13px] font-semibold text-white transition-colors hover:bg-[#9a3412] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Mark as off day"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
