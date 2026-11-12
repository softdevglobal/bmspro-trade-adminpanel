import type { Metadata } from "next";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CallRecordingsBoard } from "@/components/call-recordings-board";

export const metadata: Metadata = { title: "Calls - BMS Pro Trade" };

export default async function CallRecordingsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[]; date?: string | string[] }> }) {
  const { view, date } = await searchParams;
  const initialView = view === "ai" || view === "missed" ? view : "recordings";
  const initialDate = initialView === "missed" && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
  return <BusinessOwnerGuard>
    <CallRecordingsBoard key={initialView + ":" + (initialDate ?? "")} initialView={initialView} initialDate={initialDate} />
  </BusinessOwnerGuard>;
}
