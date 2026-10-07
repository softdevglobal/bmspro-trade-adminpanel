import { CareplusWorkspace } from "@/components/careplus-workspace";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "CarePlus - BMS Pro Trade" };

export default async function CareplusPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { tab } = await searchParams;
  return <CareplusWorkspace initialTab={tab === "onboarding" ? "onboarding" : "records"} />;
}
