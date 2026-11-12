import type { Metadata } from "next";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CallRecordingsBoard } from "@/components/call-recordings-board";

export const metadata: Metadata = { title: "Call recordings - BMS Pro Trade" };

export default function CallRecordingsPage() {
  return <BusinessOwnerGuard><CallRecordingsBoard /></BusinessOwnerGuard>;
}
