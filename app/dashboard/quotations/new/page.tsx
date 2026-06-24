import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CreateQuotationPage } from "@/components/create-quotation-page";

export default function NewQuotationPage() {
  return (
    <BusinessOwnerGuard>
      <CreateQuotationPage />
    </BusinessOwnerGuard>
  );
}
