"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useEffect, useState } from "react";

const GST_INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export function BusinessGstSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gstPercentage, setGstPercentage] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined">percent</span>
        </div>
        <div>
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            GST settings
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            GST rate used on quotations and invoices.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-5 font-body text-[13px] text-on-surface-variant">
          Loading GST settings…
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="font-body text-[13px] font-semibold text-on-surface">
              GST percentage
            </span>
            <div className="mt-2 flex max-w-xs items-center gap-2">
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
              <span className="font-body text-[14px] font-semibold text-on-surface-variant">
                %
              </span>
            </div>
            <p className="mt-1.5 font-body text-[12px] text-on-surface-variant">
              Standard Australian GST is 10%.
            </p>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
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
    </section>
  );
}
