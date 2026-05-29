"use client";

import { BusinessProfileProvider } from "@/lib/business/business-profile-context";
import { InspectionRequestsProvider } from "@/lib/inspection/inspection-requests-context";
import { BusinessNotificationsProvider } from "@/lib/notifications/business-notifications-context";
import type { ReactNode } from "react";

/** Shared dashboard Firestore listeners (one subscription each). */
export function DashboardDataProviders({ children }: { children: ReactNode }) {
  return (
    <BusinessProfileProvider>
      <InspectionRequestsProvider>
        <BusinessNotificationsProvider>{children}</BusinessNotificationsProvider>
      </InspectionRequestsProvider>
    </BusinessProfileProvider>
  );
}
