import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { ModuleAccessGuard } from "@/components/module-access-guard";
import { QuotationsBoard } from "@/components/quotations-board";

export default function QuotationsPage() {
  return (
    <BusinessOwnerGuard>
      <ModuleAccessGuard module="quotations">
        <div className="flex min-h-0 flex-1 flex-col">
          <QuotationsBoard />
        </div>
      </ModuleAccessGuard>
    </BusinessOwnerGuard>
  );
}
