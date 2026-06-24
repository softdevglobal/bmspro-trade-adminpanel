import { SuperAdminGuard } from "@/components/super-admin-guard";
import type { ReactNode } from "react";

export default function SmsPackagesLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <SuperAdminGuard>{children}</SuperAdminGuard>;
}
