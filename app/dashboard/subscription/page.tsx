import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { OwnerSubscriptionBoard } from "@/components/owner-subscription-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscription - BMS Pro Trade",
};

export default function OwnerSubscriptionPage() {
  return (
    <BusinessOwnerGuard>
      <OwnerSubscriptionBoard />
    </BusinessOwnerGuard>
  );
}
