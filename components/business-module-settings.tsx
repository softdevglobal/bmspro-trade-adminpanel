"use client";

import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import {
  BUSINESS_MODULE_LABELS,
  OWNER_TOGGLEABLE_MODULES,
  type BusinessModuleKey,
  type BusinessModuleSettings,
} from "@/lib/business/module-settings";
import Link from "next/link";
import { useEffect, useState } from "react";

const MODULE_ICONS: Record<Exclude<BusinessModuleKey, "requests">, string> = {
  quotations: "request_quote",
  invoices: "receipt_long",
  jobs: "assignment",
};

const MODULE_DESCRIPTIONS: Record<
  Exclude<BusinessModuleKey, "requests">,
  string
> = {
  quotations:
    "Create and send quotes to customers after inspection requests.",
  invoices: "Issue invoices and track payments.",
  jobs: "Schedule and manage booked jobs.",
};

type Props = {
  enabledModules: BusinessModuleSettings | null;
  loading?: boolean;
  onSaved?: (modules: BusinessModuleSettings) => void;
};

export function BusinessModuleSettings({
  enabledModules,
  loading = false,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const [modules, setModules] = useState<BusinessModuleSettings>({
    requests: true,
    quotations: false,
    invoices: false,
    jobs: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (enabledModules) {
      setModules(enabledModules);
    }
  }, [enabledModules]);

  function toggleModule(
    key: Exclude<BusinessModuleKey, "requests">,
    next: boolean,
  ) {
    setModules((current) => ({ ...current, [key]: next }));
    setSuccess(false);
    setError(null);
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/business/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabledModules: {
            quotations: modules.quotations,
            invoices: modules.invoices,
            jobs: modules.jobs,
          },
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: { enabledModules?: BusinessModuleSettings };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save module settings.");
      }
      const nextModules = payload.profile?.enabledModules ?? modules;
      setModules(nextModules);
      onSaved?.(nextModules);
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save module settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    enabledModules != null &&
    OWNER_TOGGLEABLE_MODULES.some((key) => modules[key] !== enabledModules[key]);

  return (
    <SettingsSection
      title="Trade modules"
      description="Turn on quotations, invoices, and jobs when your business is ready. Requests stay available so customers can book inspections."
      icon="tune"
    >
      {loading ? (
        <div className="flex items-center gap-2 font-body text-[13px] text-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[18px] text-primary">
            progress_activity
          </span>
          Loading module settings…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-outline-variant/80 bg-surface-container-low px-4 py-3.5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">
                    event_available
                  </span>
                  <p className="font-body text-[13px] font-semibold text-on-surface">
                    {BUSINESS_MODULE_LABELS.requests}
                  </p>
                </div>
                <p className="mt-1 pl-7 font-body text-[12px] leading-relaxed text-on-surface-variant">
                  Customer inspection requests and your booking engine. Always
                  enabled for new businesses.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-primary-fixed px-2.5 py-1 font-body text-[11px] font-semibold text-primary">
                Always on
              </span>
            </div>
          </div>

          {OWNER_TOGGLEABLE_MODULES.map((key) => (
            <div
              key={key}
              className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3.5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">
                      {MODULE_ICONS[key]}
                    </span>
                    <p className="font-body text-[13px] font-semibold leading-snug text-on-surface">
                      {BUSINESS_MODULE_LABELS[key]}
                    </p>
                  </div>
                  <p className="mt-1 pl-7 font-body text-[12px] leading-relaxed text-on-surface-variant">
                    {MODULE_DESCRIPTIONS[key]}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                  <span
                    className={`font-body text-[11px] font-bold uppercase tracking-wide ${
                      modules[key] ? "text-primary" : "text-outline"
                    }`}
                  >
                    {modules[key] ? "On" : "Off"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={modules[key]}
                    aria-label={`Enable ${BUSINESS_MODULE_LABELS[key]}`}
                    onClick={() => toggleModule(key, !modules[key])}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                      modules[key] ? "bg-primary" : "bg-outline-variant/80"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ${
                        modules[key] ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {error ? (
            <p className="rounded-lg border border-error/30 bg-error-container/60 px-3 py-2 font-body text-[12px] text-on-error-container">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="rounded-lg border border-primary/20 bg-primary-fixed/50 px-3 py-2 font-body text-[12px] text-primary">
              Module settings saved.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="font-body text-[12px] text-on-surface-variant">
              Disabled modules show a setup message until you turn them on here.
            </p>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                  Saving…
                </>
              ) : (
                "Save modules"
              )}
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}

export function ModuleDisabledMessage({
  module,
}: {
  module: Exclude<BusinessModuleKey, "requests">;
}) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-high">
        <span className="material-symbols-outlined text-[32px] text-on-surface-variant">
          lock
        </span>
      </div>
      <h2 className="font-display text-headline-sm font-semibold text-on-surface">
        {BUSINESS_MODULE_LABELS[module]} not activated
      </h2>
      <p className="mt-3 max-w-md font-body text-[14px] leading-relaxed text-on-surface-variant">
        This part of BMS Pro Trade is turned off for your business. Activate{" "}
        {BUSINESS_MODULE_LABELS[module].toLowerCase()} from Settings when you are
        ready to use it.
      </p>
      <Link
        href="/dashboard/settings"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90"
      >
        <span className="material-symbols-outlined text-[18px]">settings</span>
        Go to Settings
      </Link>
    </div>
  );
}
