"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useTenantSubscription } from "@/lib/subscription/tenant-subscription-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const SUBSCRIPTION_BILLING_PATH = "/dashboard/subscription";

function isSubscriptionBillingPath(pathname: string): boolean {
  return (
    pathname === SUBSCRIPTION_BILLING_PATH ||
    pathname.startsWith(`${SUBSCRIPTION_BILLING_PATH}/`)
  );
}

/** Redirects expired tenants to subscription billing; login still works. */
export function TenantSubscriptionAccessGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { role, status } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { accessBlocked, loading } = useTenantSubscription();

  const isOwner = role === "business_owner";
  const shouldRestrict =
    status === "authenticated" && isOwner && accessBlocked;
  const onBillingPage = isSubscriptionBillingPath(pathname ?? "");

  useEffect(() => {
    if (!shouldRestrict || loading || onBillingPage) return;
    router.replace(SUBSCRIPTION_BILLING_PATH);
  }, [shouldRestrict, loading, onBillingPage, router]);

  if (!isOwner || status !== "authenticated") {
    return <>{children}</>;
  }

  if (loading && !onBillingPage) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (shouldRestrict && !onBillingPage) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-4 text-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
        <p className="font-body text-[13px] text-on-surface-variant">
          Redirecting to subscription &amp; payment…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
