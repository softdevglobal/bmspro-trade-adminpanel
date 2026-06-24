import { PackagesBoard } from "@/components/packages-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Packages - BMS Pro Trade",
};

export default function PackagesPage() {
  return (
    <SuperAdminGuard>
      <PackagesBoard />
    </SuperAdminGuard>
  );
}
