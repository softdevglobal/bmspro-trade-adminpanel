"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Restricts dashboard routes to signed-in business owners only. */
export function BusinessOwnerGuard({ children }: { children: React.ReactNode }) {
  const { status, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && role !== "business_owner") {
      router.replace("/dashboard");
    }
  }, [status, role, router]);

  if (status !== "authenticated" || role !== "business_owner") {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
