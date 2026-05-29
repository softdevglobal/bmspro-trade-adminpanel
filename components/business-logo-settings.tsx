"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useState } from "react";

/**
 * Settings card that lets a business owner upload, replace, or remove their
 * logo. Reads the current logo live from the business doc and saves changes
 * through the business profile API.
 */
export function BusinessLogoSettings() {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const logoUrl = profile?.logoUrl ?? null;

  async function authHeaders(): Promise<Record<string, string> | null> {
    if (!user) return null;
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }

  async function saveLogo(nextUrl: string | null) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Sign in again to continue.");
      const response = await fetch("/api/business/profile", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: nextUrl }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save the logo.");
      }
      setNotice(nextUrl ? "Logo updated." : "Logo removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the logo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Sign in again to continue.");
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/uploads/business-logo", {
        method: "POST",
        headers,
        body,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        imageUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.imageUrl) {
        throw new Error(payload.error ?? "Could not upload the logo.");
      }
      await saveLogo(payload.imageUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the logo.");
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || saving;

  return (
    <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined">image</span>
        </div>
        <div>
          <h3 className="font-display text-headline-sm text-headline-sm font-semibold text-on-surface">
            Business Logo
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Appears on your booking page, dashboard, and customer emails.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-outline-variant bg-surface-container">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Business logo"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="material-symbols-outlined text-[34px] text-outline">
              storefront
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-body text-[13px] text-on-surface-variant">
            PNG, JPG, WebP or GIF up to 5 MB. A square image works best.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 ${
                busy ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {uploading ? "progress_activity" : "upload"}
              </span>
              {uploading
                ? "Uploading…"
                : logoUrl
                  ? "Replace logo"
                  : "Upload logo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {logoUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveLogo(null)}
                className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-2 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:text-error disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">
                  delete
                </span>
                Remove
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="mt-3 font-body text-[12px] font-semibold text-error">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-3 font-body text-[12px] font-semibold text-primary">
              {notice}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
