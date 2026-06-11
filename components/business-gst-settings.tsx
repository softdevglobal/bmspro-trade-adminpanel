"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useMemo, useState } from "react";

const GST_INPUT_CLASS =
  "h-11 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

const EXAMPLE_SUBTOTAL = 1000;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function BusinessGstSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gstPercentage, setGstPercentage] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const preview = useMemo(() => {
    const rate = Number.parseFloat(gstPercentage);
    if (!Number.isFinite(rate) || rate < 0) {
      return null;
    }
    const gstAmount = (EXAMPLE_SUBTOTAL * rate) / 100;
    return {
      subtotal: EXAMPLE_SUBTOTAL,
      gstAmount,
      total: EXAMPLE_SUBTOTAL + gstAmount,
      rate,
    };
  }, [gstPercentage]);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/business/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          error?: string;
          profile?: { gstPercentage: number | null };
        };
        if (!response.ok || !payload.ok || !payload.profile) {
          throw new Error(payload.error ?? "Could not load GST settings.");
        }
        if (!active) return;
        setGstPercentage(
          payload.profile.gstPercentage != null
            ? String(payload.profile.gstPercentage)
            : "10",
        );
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load GST settings.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [user]);

  async function handleSave() {
    if (!user) return;

    const parsedGst = Number.parseFloat(gstPercentage);
    if (!Number.isFinite(parsedGst) || parsedGst < 0 || parsedGst > 100) {
      setError("Enter a GST percentage between 0 and 100.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          registeredForGst: true,
          gstPercentage: parsedGst,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: { gstPercentage: number | null };
      };
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Could not save GST settings.");
      }
      setGstPercentage(
        payload.profile.gstPercentage != null
          ? String(payload.profile.gstPercentage)
          : "10",
      );
      setNotice("GST settings saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save GST settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon="percent"
      title="GST settings"
      description="GST rate used on quotations and invoices."
    >
      {loading ? (
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading GST settings…
        </p>
      ) : (
        <div className="space-y-4">
          <label className="block max-w-xs">
            <span className="font-body text-[13px] font-semibold text-on-surface">
              GST percentage
            </span>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={gstPercentage}
                disabled={saving}
                onChange={(event) => setGstPercentage(event.target.value)}
                className={GST_INPUT_CLASS}
              />
              <span className="shrink-0 font-body text-[14px] font-semibold text-on-surface-variant">
                %
              </span>
            </div>
            <p className="mt-1.5 font-body text-[12px] text-on-surface-variant">
              Standard Australian GST is 10%.
            </p>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/80 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  request_quote
                </span>
                <p className="font-body text-[12px] font-semibold text-on-surface">
                  Quotations
                </p>
              </div>
              <p className="mt-1.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
                Applied automatically to new quote line items.
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/80 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  receipt_long
                </span>
                <p className="font-body text-[12px] font-semibold text-on-surface">
                  Invoices
                </p>
              </div>
              <p className="mt-1.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
                Same rate is used when invoices are generated.
              </p>
            </div>
            <div className="rounded-xl border border-outline-variant/60 bg-surface-container-low/80 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">
                  calculate
                </span>
                <p className="font-body text-[12px] font-semibold text-on-surface">
                  Example
                </p>
              </div>
              {preview ? (
                <p className="mt-1.5 font-body text-[12px] leading-relaxed text-on-surface-variant">
                  {formatCurrency(preview.subtotal)} ex GST +{" "}
                  <span className="font-semibold text-on-surface">
                    {formatCurrency(preview.gstAmount)} GST ({preview.rate}%)
                  </span>{" "}
                  = {formatCurrency(preview.total)} inc GST
                </p>
              ) : (
                <p className="mt-1.5 font-body text-[12px] text-on-surface-variant">
                  Enter a valid percentage to preview totals.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving…" : "Save GST settings"}
            </button>
          </div>

          {error ? (
            <p className="font-body text-[12px] font-semibold text-error">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="font-body text-[12px] font-semibold text-primary">
              {notice}
            </p>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
