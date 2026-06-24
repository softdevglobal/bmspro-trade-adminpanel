import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CreateQuotationPage } from "@/components/create-quotation-page";
import { ModuleAccessGuard } from "@/components/module-access-guard";

export default function NewQuotationPage() {
  return (
    <BusinessOwnerGuard>
      <ModuleAccessGuard module="quotations">
        <CreateQuotationPage />
      </ModuleAccessGuard>
    </BusinessOwnerGuard>
  );
}
