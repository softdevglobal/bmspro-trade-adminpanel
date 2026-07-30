"use client";

import { EditJobPage } from "@/components/edit-job-page";
import { JobsBoard } from "@/components/jobs-board";
import { useDashboardPageMetaOverride } from "@/lib/dashboard/page-meta-context";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

function JobsPageInner() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job")?.trim() ?? "";
  const editJobId = searchParams.get("edit")?.trim() ?? "";
  const isEditor = Boolean(editJobId);

  const editorMeta = useMemo(
    () =>
      isEditor
        ? {
            title: "Jobs",
            hidePageHeader: true as const,
            fullBleed: true as const,
          }
        : null,
    [isEditor],
  );
  useDashboardPageMetaOverride(editorMeta);

  if (isEditor) {
    return <EditJobPage jobId={editJobId} />;
  }

  return <JobsBoard initialJobId={jobId || null} />;
}

export function JobsPageContent() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[240px] items-center justify-center">
          <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
            progress_activity
          </span>
        </div>
      }
    >
      <JobsPageInner />
    </Suspense>
  );
}
