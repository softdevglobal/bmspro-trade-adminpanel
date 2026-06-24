import { SmsPackagesBoard } from "@/components/sms-packages-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Packages - BMS Pro Trade",
};

export default function SmsPackagesPage() {
  return <SmsPackagesBoard />;
}
