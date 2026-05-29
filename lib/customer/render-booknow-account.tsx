import { AccountClient } from "@/app/account/account-client";
import type { CustomerAccountTab } from "@/components/customer-account-nav";
import {
  accountPageDescription,
  accountPageTitle,
  loadBusinessName,
} from "@/lib/customer/account-page-server";
import { notFound } from "next/navigation";

export async function renderBooknowAccountPage(
  slug: string,
  tab: CustomerAccountTab,
) {
  const businessName = await loadBusinessName(slug);
  if (!businessName) notFound();

  return <AccountClient slug={slug} businessName={businessName} tab={tab} />;
}

export async function booknowAccountMetadata(
  slug: string,
  tab: CustomerAccountTab,
) {
  const businessName = await loadBusinessName(slug);
  if (!businessName) {
    return { title: "Account not found" };
  }
  return {
    title: accountPageTitle(businessName, tab),
    description: accountPageDescription(businessName, tab),
  };
}
