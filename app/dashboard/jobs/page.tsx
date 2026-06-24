import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { JobsBoard } from "@/components/jobs-board";
import { ModuleAccessGuard } from "@/components/module-access-guard";

type JobsPageSearchParams = {
  job?: string | string[];
};

function readInitialJobId(searchParams: JobsPageSearchParams): string | null {
  const raw = Array.isArray(searchParams.job)
    ? searchParams.job[0]
    : searchParams.job;
  const jobId = typeof raw === "string" ? raw.trim() : "";
  return jobId.length > 0 ? jobId : null;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<JobsPageSearchParams>;
}) {
  const initialJobId = readInitialJobId(await searchParams);

  return (
    <BusinessOwnerGuard>
      <ModuleAccessGuard module="jobs">
        <JobsBoard initialJobId={initialJobId} />
      </ModuleAccessGuard>
    </BusinessOwnerGuard>
  );
}
