"use client";

import { TenantPackageUsageLog } from "@/components/tenant-package-usage-log";
import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import type { TenantPackageUsageCatalog } from "@/lib/catalog/tenant-package-usage-types";
import { useCallback, useEffect, useState } from "react";

type CatalogItem = { id: string; name: string };

export function AdminPackagesUsageBoard() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<TenantPackageUsageCatalog | null>(null);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/packages/usage", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        catalog?: TenantPackageUsageCatalog;
        catalogItems?: CatalogItem[];
        error?: string;
      }>(res);
      if (!res.ok || !data.ok) {
        setCatalog(null);
        setCatalogItems([]);
        setError(data.error ?? "Could not load package usage.");
        return;
      }
      setCatalog(data.catalog ?? null);
      setCatalogItems(data.catalogItems ?? []);
    } catch {
      setError("Could not load package usage.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
        <p className="font-body text-[13px] text-on-surface-variant">
          Loading package usage…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
      <TenantPackageUsageLog
        catalog={catalog}
        focus="subscription"
        groupBy="plan"
        catalogItems={catalogItems}
        showHeader={false}
      />
    </div>
  );
}
