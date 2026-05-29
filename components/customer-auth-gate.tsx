"use client";

import { CustomerAuthPanel } from "@/components/customer-auth-modal";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";

export function CustomerAuthGate({
  businessName,
  bookingSlug,
  children,
}: {
  businessName: string;
  bookingSlug?: string;
  children: React.ReactNode;
}) {
  const { status } = useCustomerAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <CustomerAuthPanel
        businessName={businessName}
        bookingSlug={bookingSlug}
        variant="page"
      />
    );
  }

  return <>{children}</>;
}
