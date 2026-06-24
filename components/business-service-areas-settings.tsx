"use client";

import { ServiceAreasField } from "@/components/service-areas-field";
import { SettingsSection } from "@/components/settings-section";
import { useAuth } from "@/lib/auth/auth-context";
import {
  MAX_SERVICE_AREAS,
  MIN_SERVICE_AREAS,
  normaliseServiceAreas,
  titleCaseServiceArea,
} from "@/lib/onboarding/types";
import { useEffect, useState } from "react";

type Props = {
  serviceAreas: string[] | null;
  loading?: boolean;
  onSaved?: (serviceAreas: string[]) => void;
};

function rowsFromAreas(areas: string[] | null): string[] {
  if (!areas || areas.length === 0) return [""];
  return areas;
}

export function BusinessServiceAreasSettings({
  serviceAreas,
  loading = false,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<string[]>(() => rowsFromAreas(serviceAreas));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    setRows(rowsFromAreas(serviceAreas));
  }, [serviceAreas, loading]);

  function updateRow(index: number, value: string) {
    setRows((current) => {
      const next = [...current];
      next[index] = titleCaseServiceArea(value);
      return next;
    });
    setError(null);
    setNotice(null);
  }

  function addRow() {
    setRows((current) => {
      if (current.length >= MAX_SERVICE_AREAS) return current;
      return [...current, ""];
    });
    setError(null);
    setNotice(null);
  }

  function removeRow(index: number) {
    setRows((current) => {
      if (current.length <= 1) return [""];
      return current.filter((_, i) => i !== index);
    });
    setError(null);
    setNotice(null);
  }

  async function handleSave() {
    if (!user) return;

    const normalized = normaliseServiceAreas(rows);
    if (normalized.length < MIN_SERVICE_AREAS) {
      setError("Add at least one service area you cover.");
      setNotice(null);
      return;
    }
    if (normalized.some((area) => area.length < 2)) {
      setError("Each service area must be at least 2 characters.");
      setNotice(null);
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
        body: JSON.stringify({ serviceAreas: normalized }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        profile?: { serviceAreas?: string[] };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save service areas.");
      }

      const saved = Array.isArray(payload.profile?.serviceAreas)
        ? payload.profile.serviceAreas
        : normalized;
      setRows(rowsFromAreas(saved));
      onSaved?.(saved);
      setNotice("Service areas saved. Your booking page will show the updated list.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save service areas.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      icon="radar"
      title="Service areas"
      description="Suburbs, towns, or regions your business serves. Changes apply to your public booking page and calendar filters."
    >
      {loading ? (
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading service areas…
        </p>
      ) : (
        <div className="space-y-5">
          <ServiceAreasField
            values={rows}
            onUpdate={updateRow}
            onAdd={addRow}
            onRemove={removeRow}
            disabled={saving}
          />

          <div className="flex flex-col gap-2 border-t border-outline-variant/50 pt-4 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-5 font-body text-[13px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving…" : "Save service areas"}
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
