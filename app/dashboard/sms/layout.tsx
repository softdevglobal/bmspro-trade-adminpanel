import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import type { ReactNode } from "react";

export default function SmsLayout({ children }: { children: ReactNode }) {
  return <BusinessOwnerGuard>{children}</BusinessOwnerGuard>;
}
