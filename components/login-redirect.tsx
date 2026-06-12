"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function LoginRedirect() {
  const { status, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (
      status === "authenticated" &&
      (role === "business_owner" || role === "super_admin")
    ) {
      router.replace("/dashboard");
    }
  }, [status, role, router]);

  return null;
}
