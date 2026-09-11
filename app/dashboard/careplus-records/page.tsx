import { CareplusOperationsBoard } from "@/components/careplus-operations-board";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CarePlus records - BMS Pro Trade",
};

export default function CareplusRecordsPage() {
  return <CareplusOperationsBoard />;
}
