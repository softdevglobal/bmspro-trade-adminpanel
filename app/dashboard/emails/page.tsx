import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { EmailsBoard } from "@/components/emails-board";

export default function EmailsPage() {
  return (
    <BusinessOwnerGuard>
      <div className="flex min-h-0 flex-1 flex-col">
        <EmailsBoard />
      </div>
    </BusinessOwnerGuard>
  );
}
