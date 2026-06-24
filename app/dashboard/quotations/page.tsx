import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { QuotationsBoard } from "@/components/quotations-board";

export default function QuotationsPage() {
  return (
    <BusinessOwnerGuard>
      <div className="flex min-h-0 flex-1 flex-col">
        <QuotationsBoard />
      </div>
    </BusinessOwnerGuard>
  );
}
