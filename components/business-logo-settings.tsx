"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { useState } from "react";

export function useBusinessLogoActions() {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const logoUrl = profile?.logoUrl ?? null;
  const busy = uploading || saving;

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

  return {
    logoUrl,
    busy,
    uploading,
    error,
    notice,
    handleFile,
    removeLogo: () => void saveLogo(null),
  };
}

type BusinessLogoUploaderProps = {
  compact?: boolean;
};

export function BusinessLogoUploader({ compact }: BusinessLogoUploaderProps) {
  const {
    logoUrl,
    busy,
    uploading,
    error,
    notice,
    handleFile,
    removeLogo,
  } = useBusinessLogoActions();

  const inputId = "business-logo-file-input";

  return (
    <div className={compact ? "" : "mt-4"}>
      <label
        htmlFor={inputId}
        className={`group relative mx-auto block w-full cursor-pointer overflow-hidden rounded-2xl border shadow-sm transition-all hover:shadow-md ${
          compact ? "max-w-[140px]" : "max-w-[200px]"
        } ${
          logoUrl
            ? "border-outline-variant/50"
            : "border-dashed border-outline-variant bg-surface-container-low"
        } ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        <div className="aspect-square w-full">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Business logo"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-surface-container-low px-3 text-center">
              <span className="material-symbols-outlined text-[28px] text-outline">
                add_photo_alternate
              </span>
              <span className="font-body text-[11px] font-semibold text-on-surface-variant">
                Upload
              </span>
            </div>
          )}
        </div>

        {logoUrl ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 font-body text-[11px] font-semibold text-white opacity-0 transition-all group-hover:bg-black/45 group-hover:opacity-100">
            {uploading ? "Uploading…" : "Change"}
          </span>
        ) : null}

        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            <span className="material-symbols-outlined animate-spin text-[24px]">
              progress_activity
            </span>
          </span>
        ) : null}

        <input
          id={inputId}
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
        <div className="mt-2 flex items-center justify-center gap-2">
          <label
            htmlFor={`${inputId}-replace`}
            className={`cursor-pointer font-body text-[11px] font-semibold text-primary hover:underline ${
              busy ? "pointer-events-none opacity-60" : ""
            }`}
          >
            Replace
            <input
              id={`${inputId}-replace`}
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
          <span className="text-outline-variant">·</span>
          <button
            type="button"
            disabled={busy}
            onClick={removeLogo}
            className="font-body text-[11px] font-semibold text-on-surface-variant transition-colors hover:text-error disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      ) : null}

      {!compact ? (
        <p className="mt-2 text-center font-body text-[11px] leading-snug text-on-surface-variant">
          PNG, JPG, WebP or GIF · up to 5 MB
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-center font-body text-[11px] font-semibold text-error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 text-center font-body text-[11px] font-semibold text-primary">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/** @deprecated Logo upload is on the settings identity hero. */
export function BusinessLogoSettings() {
  return null;
}
