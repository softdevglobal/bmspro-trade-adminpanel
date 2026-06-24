import { SmsLogBoard } from "@/components/sms-log-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Log - BMS Pro Trade",
};

export default function AdminSmsLogPage() {
  return <SmsLogBoard variant="admin" />;
}
