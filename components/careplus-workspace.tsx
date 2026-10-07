"use client";

import { useState, type KeyboardEvent } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { CareplusOperationsBoard } from "@/components/careplus-operations-board";
import { ParticipantOnboardingBoard } from "@/components/participant-onboarding-board";

type CareplusTab = "records" | "onboarding";

export function CareplusWorkspace({ initialTab = "records" }: { initialTab?: CareplusTab }) {
  const { role } = useAuth();
  const canOnboard = role === "business_owner";
  const [selectedTab, setSelectedTab] = useState<CareplusTab>(initialTab);
  const activeTab = canOnboard ? selectedTab : "records";
  const tabs: { id: CareplusTab; label: string }[] = [
    { id: "records", label: "Records" },
    ...(canOnboard ? [{ id: "onboarding" as const, label: "Participant onboarding" }] : []),
  ];

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setSelectedTab(tabs[next].id);
    document.getElementById("careplus-tab-" + tabs[next].id)?.focus();
  }

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="CarePlus" className="flex flex-wrap gap-2 border-b border-outline-variant/50 pb-3">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={"careplus-tab-" + tab.id}
            aria-selected={activeTab === tab.id}
            aria-controls={"careplus-panel-" + tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setSelectedTab(tab.id)}
            onKeyDown={(event) => navigateTabs(event, index)}
            className={"rounded-lg px-4 py-2.5 font-body text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " + (activeTab === tab.id ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high")}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Keep panels mounted so switching tabs preserves in-progress records and onboarding edits. */}
      <section role="tabpanel" id="careplus-panel-records" aria-labelledby="careplus-tab-records" hidden={activeTab !== "records"} tabIndex={0}>
        <CareplusOperationsBoard />
      </section>
      {canOnboard && (
        <section role="tabpanel" id="careplus-panel-onboarding" aria-labelledby="careplus-tab-onboarding" hidden={activeTab !== "onboarding"} tabIndex={0}>
          <ParticipantOnboardingBoard />
        </section>
      )}
    </div>
  );
}
