"use client";

import { BusinessProfileProvider } from "@/lib/business/business-profile-context";
import { BookingsProvider } from "@/lib/bookings/bookings-context";
import { InspectionRequestsProvider } from "@/lib/inspection/inspection-requests-context";
import { LeaveRequestsProvider } from "@/lib/leave/leave-requests-context";
import { SmsBalanceProvider } from "@/lib/sms/sms-balance-context";
import { BusinessNotificationsProvider } from "@/lib/notifications/business-notifications-context";
import { TenantSubscriptionProvider } from "@/lib/subscription/tenant-subscription-context";
import { TenantSubscriptionAccessGuard } from "@/components/tenant-subscription-access-guard";
import type { ReactNode } from "react";

/** Shared dashboard Firestore listeners (one subscription each). */
export function DashboardDataProviders({ children }: { children: ReactNode }) {
  return (
    <BusinessProfileProvider>
      <InspectionRequestsProvider>
        <LeaveRequestsProvider>
          <SmsBalanceProvider>
            <TenantSubscriptionProvider>
              <BookingsProvider>
                <BusinessNotificationsProvider>
                  <TenantSubscriptionAccessGuard>
                    {children}
                  </TenantSubscriptionAccessGuard>
                </BusinessNotificationsProvider>
              </BookingsProvider>
            </TenantSubscriptionProvider>
          </SmsBalanceProvider>
        </LeaveRequestsProvider>
      </InspectionRequestsProvider>
    </BusinessProfileProvider>
  );
}
