"use client";

import {
  accountPath,
  parseLegacyAccountTabQuery,
  recallBookingSlug,
} from "@/lib/customer/booking-routes";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function AccountLegacyRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  const legacyTab =
    parseLegacyAccountTabQuery(params.get("tab")) ?? "profile";

  useEffect(() => {
    const slug = recallBookingSlug();
    if (slug) {
      router.replace(accountPath(slug, legacyTab));
      return;
    }
    router.replace("/");
  }, [router, legacyTab]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#fbf8f3]">
      <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
        progress_activity
      </span>
    </main>
  );
}

export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[#fbf8f3]">
          <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
            progress_activity
          </span>
        </main>
      }
    >
      <AccountLegacyRedirect />
    </Suspense>
  );
}
