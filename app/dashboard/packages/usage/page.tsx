import { AdminPackagesUsageBoard } from "@/components/admin-packages-usage-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Package Usage - BMS Pro Trade",
};

export default function AdminPackagesUsagePage() {
  return (
    <SuperAdminGuard>
      <AdminPackagesUsageBoard />
    </SuperAdminGuard>
  );
}
