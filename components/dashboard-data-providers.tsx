"use client";

import { BusinessProfileProvider } from "@/lib/business/business-profile-context";
import { BookingsProvider } from "@/lib/bookings/bookings-context";
import { InspectionRequestsProvider } from "@/lib/inspection/inspection-requests-context";
import { LeaveRequestsProvider } from "@/lib/leave/leave-requests-context";
import { BusinessNotificationsProvider } from "@/lib/notifications/business-notifications-context";
import type { ReactNode } from "react";

/** Shared dashboard Firestore listeners (one subscription each). */
export function DashboardDataProviders({ children }: { children: ReactNode }) {
  return (
    <BusinessProfileProvider>
      <InspectionRequestsProvider>
        <LeaveRequestsProvider>
          <BookingsProvider>
            <BusinessNotificationsProvider>{children}</BusinessNotificationsProvider>
          </BookingsProvider>
        </LeaveRequestsProvider>
      </InspectionRequestsProvider>
    </BusinessProfileProvider>
  );
}
