import { OnboardShell } from "@/components/onboard-shell";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Set Up Your Business - BMS Pro Trade",
  description:
    "Onboard your trade business with BMS Pro Trade. Add your business details to get started.",
};

export default function OnboardPage() {
  return (
    <Suspense fallback={null}>
      <OnboardShell />
    </Suspense>
  );
}
