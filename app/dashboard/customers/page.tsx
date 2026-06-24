import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { CustomersBoard } from "@/components/customers-board";

export default function CustomersPage() {
  return (
    <BusinessOwnerGuard>
      <CustomersBoard />
    </BusinessOwnerGuard>
  );
}
