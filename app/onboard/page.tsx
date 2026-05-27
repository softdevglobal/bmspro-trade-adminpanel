import { OnboardShell } from "@/components/onboard-shell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Up Your Business - BMS Pro Trade",
  description:
    "Onboard your trade business with BMS Pro Trade. Add your business details to get started.",
};

export default function OnboardPage() {
  return <OnboardShell />;
}
