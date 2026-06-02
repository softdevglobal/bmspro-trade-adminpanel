import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CreateQuotationPage } from "@/components/create-quotation-page";
import { DashboardShell } from "@/components/dashboard-shell";

export default function NewQuotationPage() {
  return (
    <BusinessOwnerGuard>
      <DashboardShell title="Quotations" hidePageHeader fullBleed>
        <CreateQuotationPage />
      </DashboardShell>
    </BusinessOwnerGuard>
  );
}
