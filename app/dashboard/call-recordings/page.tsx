import type { Metadata } from "next";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CallRecordingsBoard } from "@/components/call-recordings-board";

export const metadata: Metadata = { title: "Calls - BMS Pro Trade" };

export default async function CallRecordingsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const initialView = (await searchParams).view === "ai" ? "ai" : "recordings";
  return <BusinessOwnerGuard><CallRecordingsBoard key={initialView} initialView={initialView} /></BusinessOwnerGuard>;
}
