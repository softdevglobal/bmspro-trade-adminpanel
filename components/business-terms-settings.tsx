"use client";

import { useAuth } from "@/lib/auth/auth-context";
import Link from "next/link";
import { useEffect, useState } from "react";

const TEXTAREA_CLASS =
  "mt-2 w-full resize-y rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2.5 font-body text-[14px] leading-relaxed text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function BusinessTermsSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [termsAndConditions, setTermsAndConditions] = useState("");
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
          profile?: { termsAndConditions?: string | null };
        };
        if (!response.ok || !payload.ok || !payload.profile) {
          throw new Error(payload.error ?? "Could not load terms and conditions.");
        }
        if (!active) return;
        setTermsAndConditions(payload.profile.termsAndConditions ?? "");
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load terms and conditions.",
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
          termsAndConditions: termsAndConditions.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: { termsAndConditions?: string | null };
      };
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Could not save terms and conditions.");
      }
      setTermsAndConditions(payload.profile.termsAndConditions ?? "");
      setNotice("Terms and conditions saved.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save terms and conditions.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined">gavel</span>
        </div>
        <div>
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            Terms and conditions
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Default text included on new quotations. You can still edit it on
            each quote before sending.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-5 font-body text-[13px] text-on-surface-variant">
          Loading terms and conditions…
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="font-body text-[13px] font-semibold text-on-surface">
              Quotation terms
            </span>
            <textarea
              value={termsAndConditions}
              disabled={saving}
              onChange={(event) => setTermsAndConditions(event.target.value)}
              rows={8}
              maxLength={5000}
              placeholder="Payment terms, warranty, cancellation policy, liability, etc."
              className={TEXTAREA_CLASS}
            />
            <p className="mt-1.5 font-body text-[12px] text-on-surface-variant">
              {termsAndConditions.length}/5000 characters
            </p>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save terms and conditions"}
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
