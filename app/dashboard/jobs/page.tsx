import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { JobsPageContent } from "@/components/jobs-page-content";
import { ModuleAccessGuard } from "@/components/module-access-guard";

export default function JobsPage() {
  return (
    <BusinessOwnerGuard>
      <ModuleAccessGuard module="jobs">
        <JobsPageContent />
      </ModuleAccessGuard>
    </BusinessOwnerGuard>
  );
}
