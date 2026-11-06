import type { Metadata } from "next";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { AiKnowledgeBoard } from "@/components/ai-knowledge-board";

export const metadata: Metadata = { title: "AI knowledge - BMS Pro Trade" };

export default function AiKnowledgePage() {
  return (
    <BusinessOwnerGuard>
      <AiKnowledgeBoard />
    </BusinessOwnerGuard>
  );
}
