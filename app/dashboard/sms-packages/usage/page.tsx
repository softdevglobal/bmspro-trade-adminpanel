import { AdminSmsUsageBoard } from "@/components/admin-sms-usage-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Usage - BMS Pro Trade",
};

export default function AdminSmsUsagePage() {
  return <AdminSmsUsageBoard />;
}
