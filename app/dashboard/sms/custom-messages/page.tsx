import { OwnerCustomMessagesBoard } from "@/components/owner-custom-messages-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom messages - BMS Pro Trade",
};

export default function OwnerCustomMessagesPage() {
  return <OwnerCustomMessagesBoard />;
}
