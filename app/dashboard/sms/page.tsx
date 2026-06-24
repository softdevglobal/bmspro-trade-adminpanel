import { OwnerSmsBoard } from "@/components/owner-sms-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SMS Credits - BMS Pro Trade",
};

export default function OwnerSmsPage() {
  return <OwnerSmsBoard />;
}
