"use client";

import { CustomerAuthProvider } from "@/lib/customer-auth/customer-auth-context";
import { CustomerNotificationsProvider } from "@/lib/notifications/customer-notifications-context";

/**
 * Context for the customer portal — the booking pages under /booknow and the
 * customer account area. Mounted by those layouts rather than the root one so
 * the second Firebase app and the customer notification listener stay out of
 * every admin bundle.
 */
export function CustomerProviders({ children }: { children: React.ReactNode }) {
  return (
    <CustomerAuthProvider>
      <CustomerNotificationsProvider>{children}</CustomerNotificationsProvider>
    </CustomerAuthProvider>
  );
}
