"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile, useBusinessProfileActions } from "@/lib/business/use-business-profile";

type Permission = "sophieTalkEnabled" | "sophieLiveListenEnabled";
const options: { key: Permission; label: string; description: string }[] = [
  { key: "sophieTalkEnabled", label: "Talk to Sophie", description: "Use Sophie’s voice assistant from the dashboard." },
  { key: "sophieLiveListenEnabled", label: "Listen live", description: "Listen to Sophie’s active calls for this business." },
];

export function SophieVoicePermissions() {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const actions = useBusinessProfileActions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(key: Permission, enabled: boolean) {
    if (!user || !profile || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/business/sophie-permissions", {
        method: "PATCH",
        headers: { Authorization: "Bearer " + await user.getIdToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: enabled }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save Sophie permissions.");
      actions?.mergeBusinessProfile({ [key]: result[key] === true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Sophie permissions.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <h4 className="font-display text-sm font-semibold text-on-surface">Voice permissions</h4>
      <div className="space-y-3">
        {options.map(({ key, label, description }) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant px-3 py-3">
            <span>
              <span className="block text-sm font-semibold text-on-surface">{label}</span>
              <span className="block text-xs text-on-surface-variant">{description}</span>
            </span>
            <input type="checkbox" role="switch" aria-label={label} checked={profile?.[key] === true}
              disabled={!profile || saving} onChange={event => void save(key, event.target.checked)}
              className="h-4 w-4 shrink-0 accent-primary disabled:opacity-50" />
          </label>
        ))}
        {saving && <p role="status" className="text-xs text-on-surface-variant">Saving permissions…</p>}
        {error && <p role="alert" className="text-xs text-error">{error}</p>}
      </div>
    </div>
  );
}
