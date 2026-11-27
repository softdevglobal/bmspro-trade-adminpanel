"use client";

import { ExpensesBoard } from "@/components/expenses/expenses-board";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ExpensesPageInner() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view")?.trim() || null;
  const tabParam = searchParams.get("tab");
  const tab = tabParam === "reports" || tabParam === "settings" ? tabParam : "expenses";
  // A notification link changes the query string; remount so it opens.
  return <ExpensesBoard key={`${view ?? ""}:${tab}`} initialView={view} initialTab={tab} />;
}

export function ExpensesPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[240px] items-center justify-center">
          <span className="material-symbols-outlined animate-spin text-[28px] text-primary">progress_activity</span>
        </div>
      }
    >
      <ExpensesPageInner />
    </Suspense>
  );
}
