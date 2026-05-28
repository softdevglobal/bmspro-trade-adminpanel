"use client";

import { AuthProvider } from "@/lib/auth/auth-context";
import { CustomerAuthProvider } from "@/lib/customer-auth/customer-auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CustomerAuthProvider>{children}</CustomerAuthProvider>
    </AuthProvider>
  );
}
