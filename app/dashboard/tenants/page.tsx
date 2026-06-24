import { TenantsTable } from "@/components/tenants-table";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tenants - BMS Pro Trade",
};

export default function TenantsPage() {
  return <TenantsTable />;
}
