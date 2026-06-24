import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { InvoicesPageContent } from "@/components/invoices-page-content";
import { ModuleAccessGuard } from "@/components/module-access-guard";

export default function InvoicesPage() {
  return (
    <BusinessOwnerGuard>
      <ModuleAccessGuard module="invoices">
        <InvoicesPageContent />
      </ModuleAccessGuard>
    </BusinessOwnerGuard>
  );
}
