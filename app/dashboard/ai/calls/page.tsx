import type { Metadata } from "next";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { AiCallsBoard } from "@/components/ai-calls-board";

export const metadata: Metadata = { title: "AI calls - BMS Pro Trade" };

export default function AiCallsPage() {
  return (
    <BusinessOwnerGuard>
      <AiCallsBoard />
    </BusinessOwnerGuard>
  );
}
