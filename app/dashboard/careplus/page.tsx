import { CareplusAdminBoard } from "@/components/careplus-admin-board";
import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CarePlus - BMS Pro Trade",
};

export default function CareplusPage() {
  return (
    <SuperAdminGuard>
      <CareplusAdminBoard />
    </SuperAdminGuard>
  );
}
