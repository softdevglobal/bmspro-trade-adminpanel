import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { InvoicesPageContent } from "@/components/invoices-page-content";

export default function InvoicesPage() {
  return (
    <BusinessOwnerGuard>
      <InvoicesPageContent />
    </BusinessOwnerGuard>
  );
}
