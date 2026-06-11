import type { CustomerAccountTab } from "@/components/customer-account-nav";
import { ACCOUNT_TAB_SEGMENT } from "@/lib/customer/booking-routes";
import { adminDb } from "@/lib/firebase/admin";

export async function loadBusinessName(slug: string): Promise<string | null> {
  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return typeof data.businessName === "string" ? data.businessName : null;
}

const TAB_TITLES: Record<CustomerAccountTab, string> = {
  profile: "My profile",
  requests: "My requests",
  jobs: "Job history",
  notifications: "Notifications",
  activity: "My activity",
};

export function accountPageTitle(
  businessName: string,
  tab: CustomerAccountTab,
): string {
  return `${TAB_TITLES[tab]} — ${businessName}`;
}

export function accountPageDescription(
  businessName: string,
  tab: CustomerAccountTab,
): string {
  if (!ACCOUNT_TAB_SEGMENT[tab]) {
    return `Manage your profile and jobs with ${businessName}.`;
  }
  return `${TAB_TITLES[tab]} for ${businessName} on BMS Pro Trade.`;
}
