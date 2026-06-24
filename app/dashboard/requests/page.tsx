import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { RequestsBoard } from "@/components/requests-board";

export default function RequestsPage() {
  return (
    <BusinessOwnerGuard>
      <RequestsBoard />
    </BusinessOwnerGuard>
  );
}
