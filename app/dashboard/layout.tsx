import { AuthGuard } from "@/components/auth-guard";
import { DashboardDataProviders } from "@/components/dashboard-data-providers";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard - BMS Pro Trade",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardDataProviders>{children}</DashboardDataProviders>
    </AuthGuard>
  );
}
