"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useEffect, useState } from "react";

const INPUT_CLASS =
  "mt-2 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

type ProfileForm = {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  abn: string;
};

function emptyForm(): ProfileForm {
  return {
    businessName: "",
    businessAddress: "",
    businessEmail: "",
    businessPhone: "",
    abn: "",
  };
}

export function BusinessProfileSettings() {
  const { user } = useAuth();
  const liveProfile = useBusinessProfile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
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
          profile?: {
            businessName?: string | null;
            businessAddress?: string | null;
            businessEmail?: string | null;
            businessPhone?: string | null;
            abn?: string | null;
          };
        };
        if (!response.ok || !payload.ok || !payload.profile) {
          throw new Error(payload.error ?? "Could not load business profile.");
        }
        if (!active) return;
        const p = payload.profile;
        setForm({
          businessName: p.businessName ?? "",
          businessAddress: p.businessAddress ?? "",
          businessEmail: p.businessEmail ?? "",
          businessPhone: p.businessPhone ?? "",
          abn: p.abn ?? "",
        });
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load business profile.",
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

  function updateField<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

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
          businessName: form.businessName.trim(),
          businessAddress: form.businessAddress.trim() || null,
          businessEmail: form.businessEmail.trim() || null,
          businessPhone: form.businessPhone.trim() || null,
          abn: form.abn.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: {
          businessName?: string | null;
          businessAddress?: string | null;
          businessEmail?: string | null;
          businessPhone?: string | null;
          abn?: string | null;
        };
      };
      if (!response.ok || !payload.ok || !payload.profile) {
        throw new Error(payload.error ?? "Could not save business profile.");
      }
      const p = payload.profile;
      setForm({
        businessName: p.businessName ?? "",
        businessAddress: p.businessAddress ?? "",
        businessEmail: p.businessEmail ?? "",
        businessPhone: p.businessPhone ?? "",
        abn: p.abn ?? "",
      });
      setNotice("Business profile saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save business profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  const displayName =
    liveProfile?.businessName?.trim() || form.businessName.trim() || "Your business";

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined">store</span>
        </div>
        <div>
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            Business profile
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Company details shown on your booking page, quotations, and invoices.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-5 font-body text-[13px] text-on-surface-variant">
          Loading business profile…
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="font-body text-[12px] text-on-surface-variant">
            Editing profile for <span className="font-semibold">{displayName}</span>
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business name
              </span>
              <input
                type="text"
                value={form.businessName}
                disabled={saving}
                onChange={(e) => updateField("businessName", e.target.value)}
                className={INPUT_CLASS}
                maxLength={120}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business address
              </span>
              <input
                type="text"
                value={form.businessAddress}
                disabled={saving}
                onChange={(e) => updateField("businessAddress", e.target.value)}
                className={INPUT_CLASS}
                maxLength={300}
                placeholder="Street, suburb, state, postcode"
              />
            </label>

            <label className="block">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business email
              </span>
              <input
                type="email"
                value={form.businessEmail}
                disabled={saving}
                onChange={(e) => updateField("businessEmail", e.target.value)}
                className={INPUT_CLASS}
                maxLength={120}
                placeholder="contact@yourbusiness.com.au"
              />
            </label>

            <label className="block">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                Business phone
              </span>
              <input
                type="tel"
                value={form.businessPhone}
                disabled={saving}
                onChange={(e) => updateField("businessPhone", e.target.value)}
                className={INPUT_CLASS}
                maxLength={30}
                placeholder="04xx xxx xxx"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="font-body text-[13px] font-semibold text-on-surface">
                ABN
              </span>
              <input
                type="text"
                value={form.abn}
                disabled={saving}
                onChange={(e) => updateField("abn", e.target.value)}
                className={INPUT_CLASS}
                maxLength={20}
                placeholder="11 digit Australian Business Number"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save business profile"}
            </button>
          </div>

          {error ? (
            <p className="font-body text-[12px] font-semibold text-error">{error}</p>
          ) : null}
          {notice ? (
            <p className="font-body text-[12px] font-semibold text-primary">{notice}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
