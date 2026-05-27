"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
            progress_activity
          </span>
          <p className="font-body text-body-md text-on-surface-variant">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return <>{children}</>;
}
