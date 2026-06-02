import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { DashboardShell } from "@/components/dashboard-shell";
import { ItemListBoard } from "@/components/item-list-board";

export default function ItemsPage() {
  return (
    <DashboardShell
      title="Item list"
      subtitle="Reusable line items and prices for your quotations."
      icon="inventory_2"
    >
      <BusinessOwnerGuard>
        <ItemListBoard />
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
